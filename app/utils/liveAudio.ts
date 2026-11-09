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
 * Browsers without MP3 in MSE (Firefox, iPhones) decode the same MP3 in the page instead
 * (playPcm, app/utils/livePcm.ts): blocks of 0.1 s, each scheduled with Web Audio at its exact shared time.
 */

import { ServerClock } from './serverClock'

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
        sb.appendBuffer(next as Uint8Array<ArrayBuffer>)
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
