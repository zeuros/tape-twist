import type { LiveAudio, LiveOptions } from './liveAudio'
import { ServerClock } from './serverClock'

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
