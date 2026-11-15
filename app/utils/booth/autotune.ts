/**
 * The auto-tune voice (run by the 'voice-autotune' AudioWorklet, app/workers/voice.worklet.ts):
 * finds the voice's pitch (YIN, on a 12 kHz copy) and snaps it to the nearest semitone, fast,
 * for the robotic "hard tune" sound. The shift is two crossfaded delay-line read heads whose
 * delay sweeps at the speed change (as pitchShifter in voice.ts, but steered every sample).
 */

/** Pitch looked for between these (a voice). */
const F_MIN = 80
const F_MAX = 900
/** The pitch is measured every HOP samples (at the context's rate) over WIN 12 kHz samples. */
const HOP = 512
const DS_RATE = 12000
const WIN = 512
/** YIN dip threshold: below it the voice is voiced (has a pitch). */
const YIN_THRESHOLD = 0.2
/** Below this RMS (12 kHz copy) it's a pause: no correction. */
const MIN_RMS = 0.01
/** Seconds for the correction to settle: short, so the notes snap (the robotic effect). */
const RETUNE = 0.015
/** The shifter's grain (seconds): two heads, each faded in and out over it. */
const GRAIN = 0.04

export class AutoTuneCore {
  private sr: number
  private ds: number // context samples per 12 kHz sample
  private dsAcc = 0
  private dsN = 0
  private dsPhase = 0
  private hist = new Float32Array(WIN * 2) // the last 2×WIN samples at 12 kHz (ring)
  private histAt = 0
  private sinceHop = 0
  private target = 1 // the speed (pitch ratio) the last measure asks for
  private ratio = 1
  private buf: Float32Array // input ring for the shifter
  private w = 0
  private phase = 0
  private grain: number
  private retune: number
  /** The last pitch found (Hz, 0 = none): for tests and the curious. */
  pitch = 0

  constructor(sr: number) {
    this.sr = sr
    this.ds = sr / DS_RATE
    this.grain = Math.round(GRAIN * sr)
    this.buf = new Float32Array(this.grain * 4)
    this.retune = 1 - Math.exp(-1 / (RETUNE * sr))
  }

  /** In place: `x` in, the tuned voice out. */
  process(x: Float32Array) {
    const buf = this.buf
    const n = buf.length
    const g = this.grain
    for (let i = 0; i < x.length; i++) {
      const v = x[i]!
      this.listen(v)
      buf[this.w] = v
      this.ratio += (this.target - this.ratio) * this.retune
      // Delay = grain × phase; the phase moves by (1 − ratio) / grain a sample, so the
      // delay shrinks (ratio > 1: faster, higher) or grows (lower).
      this.phase -= (this.ratio - 1) / g
      this.phase -= Math.floor(this.phase)
      let y = 0
      for (const ph of [this.phase, (this.phase + 0.5) % 1]) {
        const d = 2 + ph * g
        let r = this.w - d
        if (r < 0) r += n
        const i0 = Math.floor(r)
        const i1 = i0 + 1 === n ? 0 : i0 + 1
        const s = buf[i0]! + (buf[i1]! - buf[i0]!) * (r - i0)
        y += s * Math.sin(Math.PI * ph) ** 2 // sin² windows half a cycle apart sum to 1
      }
      x[i] = y
      this.w = this.w + 1 === n ? 0 : this.w + 1
    }
  }

  /** Feeds the 12 kHz copy; measures every HOP samples. */
  private listen(v: number) {
    this.dsAcc += v
    this.dsN++
    this.dsPhase += 1
    if (this.dsPhase >= this.ds) {
      this.dsPhase -= this.ds
      this.hist[this.histAt] = this.dsAcc / this.dsN
      this.histAt = (this.histAt + 1) % this.hist.length
      this.dsAcc = this.dsN = 0
    }
    if (++this.sinceHop < HOP) return
    this.sinceHop = 0
    const f = this.measure()
    this.pitch = f
    if (!f) {
      this.target = 1
      return
    }
    const midi = 69 + 12 * Math.log2(f / 440)
    this.target = Math.pow(2, (Math.round(midi) - midi) / 12)
  }

  /** YIN over the last WIN samples (lags up to WIN): the pitch in Hz, or 0 when unvoiced. */
  private measure() {
    const h = this.hist
    const len = h.length
    const x = new Float32Array(len)
    for (let i = 0; i < len; i++) x[i] = h[(this.histAt + i) % len]!
    let rms = 0
    for (let i = WIN; i < len; i++) rms += x[i]! * x[i]!
    if (Math.sqrt(rms / WIN) < MIN_RMS) return 0
    const tMin = Math.floor(DS_RATE / F_MAX)
    const tMax = Math.min(WIN - 1, Math.ceil(DS_RATE / F_MIN))
    const d = new Float32Array(tMax + 2)
    let sum = 0
    let best = -1
    for (let t = 1; t <= tMax + 1; t++) {
      let s = 0
      for (let j = len - WIN; j < len; j++) {
        const e = x[j]! - x[j - t]!
        s += e * e
      }
      sum += s
      d[t] = sum ? (s * t) / sum : 1 // cumulative mean normalised
      if (best < 0 && t > tMin + 1 && d[t - 1]! < YIN_THRESHOLD && d[t - 1]! <= d[t]! && d[t - 1]! <= d[t - 2]!) best = t - 1
    }
    if (best < 0) return 0
    // Parabolic interpolation around the dip.
    const [a, b, c] = [d[best - 1]!, d[best]!, d[best + 1]!]
    const den = a - 2 * b + c
    const tau = best + (den ? (0.5 * (a - c)) / den : 0)
    return DS_RATE / tau
  }
}
