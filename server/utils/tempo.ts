/**
 * Tempo of the mixed music, estimated on the server so every phone uses the same one (stutter
 * lengths, the build-up's snare roll). Kick-driven: the low band's energy rises are onsets, and
 * the autocorrelation of those onsets over the last 8 s gives the beat period, weighted towards
 * 120 BPM so a half- or double-time reading loses to the danceable one.
 */

const HOP = 240 // samples per onset frame (5 ms at 48 kHz)
const WINDOW_SEC = 8
const EVERY_SEC = 2
const MIN_BPM = 70
const MAX_BPM = 180
const BEATS = 4 // beat multiples used to refine the period

export class TempoTracker {
  private readonly hopSec: number
  private readonly a: number // one-pole low-pass coefficient (~150 Hz)
  /** Energy smoothing (two 12 ms one-poles): a steady bass note's ripple isn't a beat. */
  private readonly env: number
  private acc2 = 0
  private lp1 = 0
  private lp2 = 0
  private acc = 0
  private n = 0
  private prev = 0
  private readonly onsets: Float32Array
  private w = 0
  private filled = 0
  private sinceEstimate = 0
  private recent: number[] = []
  /** Current estimate (BPM), null while unsure (silence, no clear beat). */
  bpm: number | null = null

  constructor(private readonly sr = 48000) {
    this.hopSec = HOP / sr
    this.a = 1 - Math.exp((-2 * Math.PI * 150) / sr)
    this.env = 1 - Math.exp(-1 / (0.012 * sr))
    this.onsets = new Float32Array(Math.round(WINDOW_SEC / this.hopSec))
  }

  reset() {
    this.lp1 = this.lp2 = this.acc = this.acc2 = this.n = this.prev = this.w = this.filled = this.sinceEstimate = 0
    this.onsets.fill(0)
    this.recent = []
    this.bpm = null
  }

  /** Feed stereo audio. Returns true when the estimate changed. */
  push(L: Float32Array, R: Float32Array) {
    const { a } = this
    let changed = false
    for (let i = 0; i < L.length; i++) {
      const x = (L[i]! + R[i]!) * 0.5
      this.lp1 += a * (x - this.lp1)
      this.lp2 += a * (this.lp1 - this.lp2)
      this.acc += this.env * (this.lp2 * this.lp2 - this.acc)
      this.acc2 += this.env * (this.acc - this.acc2)
      if (++this.n < HOP) continue
      const c = Math.log1p(1000 * this.acc2) // compressed low-band energy
      this.onsets[this.w] = Math.max(0, c - this.prev - 0.02)
      this.w = (this.w + 1) % this.onsets.length
      this.filled = Math.min(this.filled + 1, this.onsets.length)
      this.prev = c
      this.n = 0
      if (++this.sinceEstimate * this.hopSec >= EVERY_SEC) {
        this.sinceEstimate = 0
        changed = this.update() || changed
      }
    }
    return changed
  }

  private update() {
    const est = this.filled >= this.onsets.length / 2 ? this.estimate() : null
    if (est == null) {
      this.recent = []
      const was = this.bpm
      this.bpm = null
      return was !== null
    }
    this.recent.push(est)
    if (this.recent.length > 3) this.recent.shift()
    const med = [...this.recent].sort((x, y) => x - y)[this.recent.length >> 1]!
    const next = Math.round(med * 2) / 2
    if (this.bpm != null && Math.abs(next - this.bpm) < 1) return false
    this.bpm = next
    return true
  }

  /** Beat period from the onset autocorrelation, or null without a clear beat. */
  private estimate() {
    const len = this.filled
    const o = new Float32Array(len)
    const start = this.filled < this.onsets.length ? 0 : this.w
    let mean = 0
    for (let i = 0; i < len; i++) mean += o[i] = this.onsets[(start + i) % this.onsets.length]!
    mean /= len
    let energy = 0
    for (let i = 0; i < len; i++) energy += (o[i]! -= mean) ** 2
    if (energy < 1e-6) return null

    const lagMin = Math.floor(60 / MAX_BPM / this.hopSec)
    const lagMax = Math.ceil(60 / MIN_BPM / this.hopSec)
    const rMax = Math.min(len - 1, BEATS * (lagMax + 1))
    const r = new Float32Array(rMax + 2)
    for (let lag = lagMin - 1; lag <= rMax; lag++) {
      let s = 0
      for (let i = lag; i < len; i++) s += o[i]! * o[i - lag]!
      r[lag] = s / (len - lag)
    }
    let best = -1
    let bestScore = 0
    for (let lag = lagMin; lag <= lagMax; lag++) {
      if (!(r[lag]! >= r[lag - 1]! && r[lag]! >= r[lag + 1]!)) continue // peaks only
      const bpm = 60 / (lag * this.hopSec)
      const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2)
      const score = r[lag]! * prior
      if (score > bestScore) [best, bestScore] = [lag, score]
    }
    if (best < 0 || r[best]! < 0.08 * (energy / len)) return null // no clear periodicity
    // Fine period: the one whose multiples (1 to 4 beats) line up best. One beat alone is only
    // known to a frame (5 ms); four beats pin it down to ~1 ms.
    const at = (x: number) => {
      const i = Math.floor(x)
      return i + 1 > rMax ? -Infinity : r[i]! + (r[i + 1]! - r[i]!) * (x - i)
    }
    let lag = best
    let top = -Infinity
    for (let x = best - 1; x <= best + 1; x += 0.02) {
      let s = 0
      for (let k = 1; k <= BEATS; k++) s += at(k * x)
      if (s > top) [lag, top] = [x, s]
    }
    return 60 / (lag * this.hopSec)
  }
}
