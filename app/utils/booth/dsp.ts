/** Small Web Audio building blocks shared by the booth's music and voice chains. */

export const dbToGain = (db: number) => Math.pow(10, db / 20)

export function gainNode(ctx: BaseAudioContext, v = 1) {
  const g = ctx.createGain()
  g.gain.value = v
  return g
}

export function biquad(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = Math.SQRT1_2, gainDb = 0) {
  const b = ctx.createBiquadFilter()
  b.type = type
  b.frequency.value = f
  b.Q.value = q
  b.gain.value = gainDb
  return b
}

/** Transparent below 0.9, soft-saturates above, never exceeds 1. Input pre-scaled by 0.5. */
export function softLimitCurve() {
  const n = 4097
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2
    const a = Math.abs(x)
    c[i] = a > 0.9 ? Math.sign(x) * (0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1)) : x
  }
  return c
}

export function driveCurve(drive: number) {
  const n = 2049
  const c = new Float32Array(n)
  const norm = Math.tanh(drive)
  for (let i = 0; i < n; i++) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * drive) / norm
  return c
}

/** 4 s loop of vinyl crackle (random decaying pops) and soft hiss. */
export function noiseBuffer(ctx: BaseAudioContext, crackle: number, hiss: number) {
  const len = ctx.sampleRate * 4
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  const L = buf.getChannelData(0)
  const R = buf.getChannelData(1)
  const k = 48000 / ctx.sampleRate // the probabilities were tuned at 48 kHz
  let pop = 0
  let lp = 0
  for (let i = 0; i < len; i++) {
    if (Math.random() < crackle * k) pop = (Math.random() * 2 - 1) * (0.15 + Math.random() * 0.35)
    pop *= 0.55
    lp += 0.3 * (Math.random() * 2 - 1 - lp)
    L[i] = R[i] = pop + lp * hiss
  }
  return buf
}

/** Fairground tannoy reverb: early slaps off the stalls, then a long bright tail (2.6 s). */
export function funfairReverb(ctx: BaseAudioContext) {
  const sr = ctx.sampleRate
  const len = Math.floor(sr * 2.6)
  const buf = ctx.createBuffer(2, len, sr)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    const pre = Math.floor(sr * (0.025 + c * 0.007))
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 2.6) * 0.35
    }
    for (const [ms, g] of [[41, 0.6], [67, 0.45], [93, 0.4], [151, 0.3], [212, 0.22]] as const) {
      const i = Math.floor(sr * (ms + c * 9) / 1000)
      if (i < len) d[i]! += c ? -g : g
    }
  }
  return buf
}

/** Mono 16-bit WAV of the first channel, peak-normalised to 0.9. */
export function wav(buf: AudioBuffer) {
  const d = buf.getChannelData(0)
  let peak = 0
  for (const x of d) peak = Math.max(peak, Math.abs(x))
  const k = peak > 0 ? 0.9 / peak : 1
  const out = new DataView(new ArrayBuffer(44 + d.length * 2))
  const str = (o: number, t: string) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); out.setUint32(4, 36 + d.length * 2, true); str(8, 'WAVEfmt ')
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true)
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * 2, true)
  out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, d.length * 2, true)
  for (let i = 0; i < d.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i]! * k)) * 0x7fff, true)
  return new Blob([out.buffer], { type: 'audio/wav' })
}
