/**
 * Player for the live MP3 stream, kept in sync with every other listening device.
 *
 * The page fetches the stream itself and feeds it to the element through Media Source
 * Extensions, so it knows exactly which sample is playing. The server says when each
 * sample was rendered on its clock (server/utils/mixer.ts), the page measures the offset
 * between its clock and the server's (like NTP), and every device plays sample s at
 * the same server time: anchor + s/SR + delay. Small errors are steered out with the
 * playback rate (≤2 %), big ones with a jump.
 *
 * `ahead` (seconds, per device) plays this device earlier, for speakers that add their own
 * delay (Bluetooth: 0.1–0.3 s).
 *
 * Browsers without MP3 in MSE (Firefox, iPhones) get the same audio as raw PCM instead
 * (playPcm): blocks of 0.1 s, each scheduled with Web Audio at its exact shared time.
 * That's ~1.5 Mbit/s per device, fine on a LAN.
 */

const KEEP_BEHIND = 20 // seconds of played audio kept in the buffer
const JUMP_ABOVE = 0.25 // s of error fixed by a jump instead of the rate
const SETTLE_JUMP = 0.02 // right after starting, smaller errors still jump (a few times)
const DEADBAND = 0.006 // s of error left alone
const MAX_RATE = 0.02 // rate change used to steer
// Unsynced fallback (no clock yet): stay ~0.5 s behind the live edge.
const TARGET = 0.5
const SPEEDUP_ABOVE = 0.9

export interface SyncInfo {
  /** Last measured error, in ms (positive: this device is late). */
  errorMs: number
  /** Round trip of the best clock probe, in ms (sync precision is about half of it). */
  rttMs: number
}

export interface LiveAudio {
  stop(): void
  /** Current delay behind the server, in seconds (null when unknown: fallback mode). */
  lag(): number | null
  /** Sync state, or null while not synced. */
  sync(): SyncInfo | null
}

export interface LiveOptions {
  /** Called when sound starts. */
  onPlaying?: () => void
  /** Seconds this device plays earlier than the others (its speaker's own delay). */
  ahead: () => number
  /** Seconds between the element and the speaker (Web Audio output latency). */
  outputLatency: () => number
}

export const lowLatencySupported = () =>
  typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg')

// ------------------------------------------------------------------ clock

interface ClockReply {
  now: number
  anchor: number | null
  epoch: number
  sr: number
  delay: number
}

/** Offset between this page's clock and the server's, from the probes with the shortest round trip. */
class ServerClock {
  offset: number | null = null // server ms − performance.now()
  rtt = Infinity
  info: ClockReply | null = null
  private probes: { offset: number; rtt: number; at: number }[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false

  async start() {
    for (let i = 0; i < 8 && !this.stopped; i++) await this.probe()
    this.schedule()
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
  }

  now() {
    return this.offset == null ? null : performance.now() + this.offset
  }

  private refreshing = false
  /** Ask again soon (the stream (re)started and its timeline wasn't known yet). */
  refresh() {
    if (this.refreshing || this.offset == null) return // the first probes are still running
    this.refreshing = true
    clearTimeout(this.timer)
    this.timer = setTimeout(async () => {
      await this.probe()
      this.refreshing = false
      this.schedule()
    }, 500)
  }

  private schedule() {
    if (this.stopped) return
    this.timer = setTimeout(async () => {
      for (let i = 0; i < 3; i++) await this.probe()
      this.schedule()
    }, 10_000)
  }

  private async probe() {
    try {
      const t0 = performance.now()
      const r = (await (await fetch(`/api/clock?t=${Math.random()}`, { cache: 'no-store' })).json()) as ClockReply
      const t1 = performance.now()
      this.info = r
      // Keep a minute of probes; phone and server clocks drift a little, so old ones expire.
      this.probes.push({ offset: r.now - (t0 + t1) / 2, rtt: t1 - t0, at: t1 })
      this.probes = this.probes.filter((p) => t1 - p.at < 60_000)
      const best = this.probes.reduce((a, b) => (b.rtt < a.rtt ? b : a))
      this.offset = best.offset
      this.rtt = best.rtt
    } catch {
      /* next round */
    }
  }
}

// ------------------------------------------------------------------ player

export function playLive(a: HTMLAudioElement, url: string, onTrouble: () => void, opts: LiveOptions): LiveAudio {
  if (!lowLatencySupported()) {
    a.src = url
    a.play().catch(() => {})
    return { stop: () => detach(a), lag: () => null, sync: () => null }
  }

  const abort = new AbortController()
  const ms = new MediaSource()
  const objectUrl = URL.createObjectURL(ms)
  const clock = new ServerClock()
  void clock.start()
  let stopped = false
  let timer: ReturnType<typeof setInterval> | undefined
  let startSample: number | null = null
  let epoch: number | null = null
  let lastError: number | null = null
  const openedAt = performance.now()
  let settleJumps = 0 // jumps left to land precisely after (re)starting
  const recent: number[] = []
  a.src = objectUrl
  a.playbackRate = 1
  a.preservesPitch = false // steering by ±2 % resamples cleanly instead of time-stretching

  const fail = () => {
    if (!stopped) onTrouble()
  }

  /** Where the element should be now (media seconds), or null while that's unknown. */
  const target = () => {
    const now = clock.now()
    const c = clock.info
    if (now == null || !c || c.anchor == null || startSample == null || c.epoch !== epoch) return null
    const heard = (now - c.anchor) / 1000 - c.delay + opts.ahead() // stream second to be heard now
    return heard - startSample / c.sr + opts.outputLatency()
  }

  const steer = () => {
    if (!a.buffered.length) return
    const start = a.buffered.start(0)
    const end = a.buffered.end(a.buffered.length - 1)
    const t = target()
    if (t == null) {
      lastError = null
      if (epoch != null && (clock.info?.epoch !== epoch || clock.info.anchor == null)) clock.refresh()
      // Give the clock a moment before playing unsynced (it would jump right after).
      if (a.paused && performance.now() - openedAt > 3000) a.play().catch(() => {})
      keepLive(a, end)
      return
    }
    if (t > end - 0.05 || t < start) {
      // Not received yet (a stall) or already dropped: wait for it, then jump.
      lastError = null
      if (t > end - 0.05 && !a.paused) a.pause()
      if (t < start) a.currentTime = start
      return
    }
    const err = a.currentTime - t // > 0: ahead of the others
    lastError = -err
    if (a.paused || Math.abs(err) > JUMP_ABOVE || (settleJumps > 0 && Math.abs(err) > SETTLE_JUMP)) {
      // Starting playback takes a moment the element doesn't count, so after a start
      // the next ticks re-measure and jump again until it lands.
      settleJumps = a.paused || Math.abs(err) > JUMP_ABOVE ? 3 : settleJumps - 1
      recent.length = 0
      a.currentTime = t
      a.playbackRate = 1
      if (a.paused) a.play().catch(() => {})
      return
    }
    settleJumps = 0
    // The element's clock reads in steps of a few ms: steer on the median of the last second.
    recent.push(err)
    if (recent.length > 5) recent.shift()
    const e = [...recent].sort((x, y) => x - y)[recent.length >> 1]!
    lastError = -e
    a.playbackRate = Math.abs(e) < DEADBAND ? 1 : 1 - Math.max(-MAX_RATE, Math.min(MAX_RATE, e * 0.3))
  }

  ms.addEventListener('sourceopen', async () => {
    const sb = ms.addSourceBuffer('audio/mpeg')
    sb.mode = 'sequence' // the first byte is media time 0, i.e. sample `startSample`
    const queue: Uint8Array[] = []
    let lastTrim = 0
    const pump = () => {
      if (stopped || sb.updating || ms.readyState !== 'open') return
      const t = a.currentTime
      // Drop audio that has already played, so a whole evening doesn't pile up in memory.
      if (sb.buffered.length && t - sb.buffered.start(0) > KEEP_BEHIND + 10 && t - lastTrim > 10) {
        lastTrim = t
        sb.remove(0, t - KEEP_BEHIND)
        return
      }
      const next = queue.shift()
      if (!next) return
      try {
        sb.appendBuffer(next)
      } catch {
        fail() // quota or decode error: start over
      }
    }
    sb.addEventListener('updateend', pump)

    timer = setInterval(steer, 200)

    try {
      const res = await fetch(url, { signal: abort.signal, cache: 'no-store' })
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
      const s = res.headers.get('x-stream-start')
      const e = res.headers.get('x-stream-epoch')
      startSample = s == null ? null : Number(s)
      epoch = e == null ? null : Number(e)
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) throw new Error('stream ended')
        queue.push(value)
        pump()
      }
    } catch {
      fail()
    }
  }, { once: true })

  return {
    stop() {
      stopped = true
      clearInterval(timer)
      clock.stop()
      abort.abort()
      detach(a)
      URL.revokeObjectURL(objectUrl)
    },
    lag() {
      const now = clock.now()
      const c = clock.info
      if (now != null && c?.anchor != null && startSample != null && c.epoch === epoch) {
        return Math.max(0, (now - c.anchor) / 1000 - (startSample / c.sr + a.currentTime) + opts.outputLatency())
      }
      return a.buffered.length ? Math.max(0, a.buffered.end(a.buffered.length - 1) - a.currentTime) : 0
    },
    sync: () => (lastError == null ? null : { errorMs: lastError * 1000, rttMs: clock.rtt }),
  }
}

// ------------------------------------------------------------------ PCM player

const BLOCK = 4800 // frames per scheduled block (0.1 s at 48 kHz)
const PCM_JUMP = 0.03 // s of error fixed by rescheduling instead of the rate
const PCM_DEADBAND = 0.002
const PCM_MAX_RATE = 0.005 // ±0.5 %: inaudible

interface Block {
  buf: AudioBuffer
  s: number // stream sample of its first frame
  src: AudioBufferSourceNode | null
  t: number // context time it starts at
  end: number
}

/**
 * Raw PCM stream (s16le stereo 48 kHz) played with Web Audio, for browsers that can't
 * stream MP3 through MSE. Each block is scheduled at the context time matching its shared
 * server time; consecutive blocks are butted together, and drift is steered out with a
 * tiny playback-rate change on the next blocks.
 */
export function playPcm(ctx: AudioContext, dest: AudioNode, url: string, onTrouble: () => void, opts: LiveOptions): LiveAudio {
  const abort = new AbortController()
  const clock = new ServerClock()
  void clock.start()
  let stopped = false
  let startSample: number | null = null
  let epoch: number | null = null
  let nextT: number | null = null // where the next block starts if it follows on
  let lastError: number | null = null
  let started = false
  let blocks: Block[] = [] // scheduled and not finished yet
  const mapping: number[] = [] // recent (performance ms − context ms) readings
  let lastMapAt = -Infinity

  /** Context time at which stream sample `s` should be heard, or null while unknown. */
  const idealTime = (s: number) => {
    const c = clock.info
    if (clock.offset == null || !c || c.anchor == null || c.epoch !== epoch) return null
    const serverMs = c.anchor + (s / c.sr) * 1000 + (c.delay - opts.ahead()) * 1000
    const perfMs = serverMs - clock.offset
    const ts = ctx.getOutputTimestamp?.()
    // getOutputTimestamp tells what is at the speaker now, so output latency is included.
    // Its context time only moves once per audio callback (a ±20 ms sawtooth in Firefox),
    // so the true link between the two clocks is the lowest reading of the last seconds.
    if (ts?.performanceTime && ts.contextTime != null) {
      if (ts.performanceTime - lastMapAt > 50) {
        lastMapAt = ts.performanceTime
        mapping.push(ts.performanceTime - ts.contextTime * 1000)
        if (mapping.length > 60) mapping.shift()
      }
      return (perfMs - Math.min(...mapping)) / 1000
    }
    const c2 = ctx as AudioContext & { outputLatency?: number }
    return ctx.currentTime + (perfMs - performance.now()) / 1000 - (c2.outputLatency || 0) - (ctx.baseLatency || 0)
  }

  const startBlock = (b: Block, t: number, rate: number) => {
    const now = ctx.currentTime
    const dur = b.buf.duration / rate
    b.t = t
    b.end = t + dur
    if (b.end <= now + 0.005) return (b.src = null) // too late: skip it
    const src = ctx.createBufferSource()
    src.buffer = b.buf
    src.playbackRate.value = rate
    src.connect(dest)
    if (t >= now) src.start(t)
    else src.start(now, (now - t) * rate) // partly late: play the rest
    b.src = src
    if (!started) {
      started = true
      opts.onPlaying?.()
    }
  }

  /** Throw away the schedule and place every waiting block at its ideal time again. */
  const reschedule = (from: Block[]) => {
    const now = ctx.currentTime
    nextT = null
    for (const b of from) {
      if (b.src && b.t <= now + 0.01) continue // already sounding: let it finish
      b.src?.stop()
      b.src?.disconnect()
      const t = idealTime(b.s)
      if (t == null) continue
      startBlock(b, nextT ?? t, 1)
      nextT = b.end
    }
  }

  const schedule = (b: Block) => {
    const now = ctx.currentTime
    blocks = blocks.filter((x) => x.end > now)
    blocks.push(b)
    const ideal = idealTime(b.s)
    if (ideal == null) {
      // No shared clock yet: just play it continuously, a little ahead of now.
      lastError = null
      if (startSample != null && epoch != null) clock.refresh()
      if (nextT == null || nextT < now) nextT = now + 0.3
      startBlock(b, nextT, 1)
      nextT = b.end
      return
    }
    const err = nextT == null ? Infinity : nextT - ideal // > 0: running late
    if (Math.abs(err) > PCM_JUMP) {
      lastError = 0
      reschedule(blocks)
      return
    }
    lastError = err
    const rate = Math.abs(err) < PCM_DEADBAND ? 1 : 1 + Math.max(-PCM_MAX_RATE, Math.min(PCM_MAX_RATE, err * 0.25))
    startBlock(b, nextT!, rate)
    nextT = b.end
  }

  void (async () => {
    try {
      const res = await fetch(url, { signal: abort.signal, cache: 'no-store' })
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
      startSample = Number(res.headers.get('x-stream-start'))
      epoch = Number(res.headers.get('x-stream-epoch'))
      const reader = res.body.getReader()
      const bytes = BLOCK * 4
      let acc = new Uint8Array(bytes * 4)
      let fill = 0
      let pos = 0 // frames received
      for (;;) {
        const { done, value } = await reader.read()
        if (done) throw new Error('stream ended')
        if (fill + value.length > acc.length) {
          const bigger = new Uint8Array((fill + value.length) * 2)
          bigger.set(acc.subarray(0, fill))
          acc = bigger
        }
        acc.set(value, fill)
        fill += value.length
        let off = 0
        while (fill - off >= bytes) {
          const pcm = new Int16Array(acc.slice(off, off + bytes).buffer)
          off += bytes
          const buf = new AudioBuffer({ numberOfChannels: 2, length: BLOCK, sampleRate: 48000 })
          const L = new Float32Array(BLOCK)
          const R = new Float32Array(BLOCK)
          for (let i = 0; i < BLOCK; i++) {
            L[i] = pcm[2 * i]! / 32768
            R[i] = pcm[2 * i + 1]! / 32768
          }
          buf.copyToChannel(L, 0)
          buf.copyToChannel(R, 1)
          if (stopped) return
          schedule({ buf, s: startSample + pos, src: null, t: 0, end: 0 })
          pos += BLOCK
        }
        acc.copyWithin(0, off, fill)
        fill -= off
      }
    } catch {
      if (!stopped) onTrouble()
    }
  })()

  return {
    stop() {
      stopped = true
      clock.stop()
      abort.abort()
      for (const b of blocks) {
        try {
          b.src?.stop()
        } catch {
          /* never started */
        }
        b.src?.disconnect()
      }
      blocks = []
    },
    lag: () => (clock.info ? clock.info.delay - opts.ahead() : null),
    sync: () => (lastError == null ? null : { errorMs: lastError * 1000, rttMs: clock.rtt }),
  }
}

/** Unsynced fallback: stay near the live edge. */
function keepLive(a: HTMLAudioElement, end: number) {
  const lag = end - a.currentTime
  if (lag > 2) {
    a.currentTime = end - TARGET
    a.playbackRate = 1
  } else if (lag > SPEEDUP_ABOVE) a.playbackRate = 1.04
  else if (lag <= TARGET) a.playbackRate = 1
}

function detach(a: HTMLAudioElement) {
  a.pause()
  a.removeAttribute('src')
  a.load()
  a.playbackRate = 1
}
