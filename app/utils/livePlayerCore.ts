/**
 * The live player's core, run inside an AudioWorklet (app/workers/livePlayer.worklet.ts): one
 * continuous read position through the decoded stream, instead of one AudioBufferSourceNode per
 * 0.1 s block. Reading interpolates between samples, so the speed can be nudged smoothly (no
 * seam where a block ends), and the stream's 48 kHz plays at any context rate.
 *
 * The page says where the stream should be (`setMap`: stream sample s0 at context time t0, so
 * sample s at t0 + (s − s0)/48000, from its server-clock sync); the core steers its position
 * there by playing up to ±0.5 % faster or slower, or jumps there when it is off by over 30 ms.
 * Samples that haven't arrived play as silence; blocks that arrive already over are dropped.
 */

export const STREAM_SR = 48000
export const LIVE_JUMP = 0.03 // s of error fixed by a jump instead of the speed
export const LIVE_DEADBAND = 0.002
export const LIVE_MAX_RATE = 0.005 // ±0.5 %: inaudible
const STEER = 0.25 // speed change per second of error: an error fades with a ~4 s time constant
/** Unsynced (no map yet): wait for this much audio before playing. */
export const UNSYNCED_LEAD = 0.3

export interface LiveBlock {
  l: Float32Array
  r: Float32Array
  /** Stream sample of its first frame. */
  s: number
}

export interface LiveStats {
  /** Last error in seconds (> 0: late), null while unsynced. */
  err: number | null
  /** Seconds between each block's arrival and its play time (< 0: arrived late). */
  leads: number[]
  /** Blocks dropped as already over, and blocks queued, since the last stats. */
  late: number
  played: number
  /** Output frames with nothing to play (a gap in the stream), and jumps, since the last stats. */
  starved: number
  jumps: number
  /** Stream sample being played. */
  pos: number
}

export class LivePlayerCore {
  private queue: LiveBlock[] = []
  private pos: number | null = null // stream sample at the start of the next output frame
  private map: { s0: number; t0: number } | null = null
  private cur: LiveBlock | null = null
  private err: number | null = null
  private stats = { leads: [] as number[], late: 0, played: 0, starved: 0, jumps: 0 }
  /** Called once, on the first frame of real audio. */
  onPlaying?: () => void
  private playing = false

  push(b: LiveBlock) {
    const end = b.s + b.l.length
    // Before the first sound, blocks already over are the start-up backlog the server sends (the
    // past few seconds), not lateness: they don't count, nor does the silence before it.
    if (this.pos != null && end <= this.pos) {
      if (this.playing) {
        this.stats.late++
        this.stats.leads.push((end - this.pos) / STREAM_SR)
      }
      return
    }
    this.stats.played++
    if (this.pos != null && this.playing) this.stats.leads.push((b.s - this.pos) / STREAM_SR)
    this.queue.push(b)
    if (this.queue.length > 1 && this.queue.at(-2)!.s > b.s) this.queue.sort((a, c) => a.s - c.s)
  }

  setMap(s0: number, t0: number) {
    this.map = { s0, t0 }
  }

  /** Clears the map (the clock link is measured again): plays on unsynced until the next one. */
  clearMap() {
    this.map = null
    this.err = null
  }

  /** Where the stream should be at context time t, or null while unsynced. */
  private target(t: number) {
    return this.map ? this.map.s0 + (t - this.map.t0) * STREAM_SR : null
  }

  private at(i: number, ch: 0 | 1): number | null {
    let b = this.cur
    if (!b || i < b.s || i >= b.s + b.l.length) {
      b = null
      for (const q of this.queue) {
        if (i < q.s) break
        if (i < q.s + q.l.length) {
          b = q
          break
        }
      }
      if (!b) return null
      this.cur = b
    }
    return (ch === 0 ? b.l : b.r)[i - b.s]!
  }

  /** Fills one render quantum starting at context time `t` (`sr`: the context's rate). */
  render(L: Float32Array, R: Float32Array, t: number, sr: number) {
    const want = this.target(t)
    if (this.pos == null) {
      if (want != null) this.pos = want
      else if (this.queue.length && (this.queue.at(-1)!.s + this.queue.at(-1)!.l.length - this.queue[0]!.s) / STREAM_SR >= UNSYNCED_LEAD)
        this.pos = this.queue[0]!.s
      else return L.fill(0), R.fill(0)
    }
    let rate = 1
    if (want != null) {
      let err = (want - this.pos) / STREAM_SR // > 0: playing late
      if (Math.abs(err) > LIVE_JUMP) {
        this.pos = want
        this.stats.jumps++
        err = 0
      }
      this.err = err
      if (Math.abs(err) >= LIVE_DEADBAND) rate = 1 + Math.max(-LIVE_MAX_RATE, Math.min(LIVE_MAX_RATE, err * STEER))
    } else this.err = null
    const step = (rate * STREAM_SR) / sr
    let pos = this.pos
    for (let k = 0; k < L.length; k++) {
      const i = Math.floor(pos)
      const f = pos - i
      const l0 = this.at(i, 0)
      if (l0 == null) {
        L[k] = R[k] = 0
        if (this.playing) this.stats.starved++
      } else {
        const l1 = this.at(i + 1, 0) ?? l0
        const r0 = this.at(i, 1)!
        const r1 = this.at(i + 1, 1) ?? r0
        L[k] = l0 + (l1 - l0) * f
        R[k] = r0 + (r1 - r0) * f
        if (!this.playing) {
          this.playing = true
          this.onPlaying?.()
        }
      }
      pos += step
    }
    this.pos = pos
    // Drop what's been played.
    const done = Math.floor(pos) - 1
    while (this.queue.length && this.queue[0]!.s + this.queue[0]!.l.length <= done) {
      if (this.queue[0] === this.cur) this.cur = null
      this.queue.shift()
    }
  }

  /** Stats since the last call. */
  takeStats(): LiveStats {
    const s = { ...this.stats, err: this.err, pos: this.pos ?? 0 }
    this.stats = { leads: [], late: 0, played: 0, starved: 0, jumps: 0 }
    return s
  }
}
