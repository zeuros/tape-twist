/**
 * Auto-sync: sets this device's "ahead" from what the mic hears in the room.
 *
 *  1. This device goes quiet (the stream keeps running, synced) and records two signals
 *     side by side, sample-locked in one ScriptProcessor: the music it would be playing
 *     (`tap`) and the mic. The lag between them is D = speaker path + mic path + E,
 *     where E is how much later the room sounds than this device would.
 *  2. It then plays a few short chirps through its own output and records them the same way:
 *     the lag is R = speaker path + mic path (Bluetooth delay included).
 *  3. E = D − R; both paths cancel out. Playing E later lines this device up with the room,
 *     so the caller adds R − D to "ahead".
 *
 * Lags are found with GCC-PHAT (cross-correlation with a whitened spectrum), which gives a
 * sharp peak even on music full of repeated beats.
 */

export interface AutoSyncResult {
  /** Seconds to add to "ahead". */
  shift: number
  /** False when the chirps weren't heard (headphones): the speaker delay is the browser's guess. */
  loopback: boolean
}

export interface AutoSyncIo {
  /** The music as this device would play it, before its output. */
  tap: AudioNode
  /** Where to inject the chirps: the same output path as the music, after `tap`. */
  inject: AudioNode
  /** Silences this device's music (not the chirps). */
  mute: (on: boolean) => void
  /** Speaker delay reported by the browser, in seconds (fallback when no chirp is heard). */
  outputLatency: () => number
}

const SETTLE = 0.6 // s of silence before recording the room (own sound dies out)
const MUSIC_SEC = 5
const CHIRPS = [0.3, 0.75, 1.3, 1.7] // uneven spacing: no strong side peaks
const CHIRP_SEC = 0.08
const CHIRP_TAIL = 1.1 // s recorded after the last chirp (a slow Bluetooth speaker)
const DOWN = 4 // 48 kHz → 12 kHz for the correlation
const MIN_SCORE = 7 // peak height in standard deviations of the correlation

const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000))

export async function measureRoom(ctx: AudioContext, io: AutoSyncIo): Promise<AutoSyncResult> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no microphone in this browser')
  const stream = await openMic()
  const sr = ctx.sampleRate
  const mic = ctx.createMediaStreamSource(stream)
  const chirpBus = ctx.createGain()
  const merger = ctx.createChannelMerger(3)
  io.tap.connect(merger, 0, 0)
  chirpBus.connect(merger, 0, 1)
  mic.connect(merger, 0, 2)
  chirpBus.connect(io.inject)
  const proc = ctx.createScriptProcessor(4096, 3, 1)
  const sink = ctx.createGain()
  sink.gain.value = 0
  merger.connect(proc).connect(sink).connect(ctx.destination) // runs only when connected

  let store: Float32Array[][] | null = null
  proc.onaudioprocess = (e) => {
    if (store) for (let c = 0; c < 3; c++) store[c]!.push(e.inputBuffer.getChannelData(c).slice())
  }

  try {
    io.mute(true)
    await wait(SETTLE)
    const music: Float32Array[][] = [[], [], []]
    store = music
    await wait(MUSIC_SEC)

    const chirps: Float32Array[][] = [[], [], []]
    store = chirps
    const buf = chirpBuffer(ctx)
    const t0 = ctx.currentTime
    for (const at of CHIRPS) {
      const s = ctx.createBufferSource()
      s.buffer = buf
      s.connect(chirpBus)
      s.start(t0 + at)
    }
    await wait(CHIRPS.at(-1)! + CHIRP_SEC + CHIRP_TAIL)
    store = null

    const room = gccPhat(join(music[0]!), join(music[2]!), sr, -0.7, 1.4, 150, 5000)
    if (room.score < MIN_SCORE) {
      throw new Error(rms(join(music[0]!)) < 1e-4 ? 'nothing is playing' : 'couldn\'t hear the music: hold the device near a speaker')
    }
    const own = gccPhat(join(chirps[1]!), join(chirps[2]!), sr, 0, 1, 700, 5500)
    const loopback = own.score >= MIN_SCORE
    const inLatency = (stream.getAudioTracks()[0]?.getSettings() as { latency?: number }).latency ?? 0.01
    const r = loopback ? own.lag : io.outputLatency() + inLatency
    return { shift: r - room.lag, loopback }
  } finally {
    store = null
    io.mute(false)
    proc.onaudioprocess = null
    for (const n of [proc, merger, mic, chirpBus, sink]) n.disconnect()
    try {
      io.tap.disconnect(merger)
    } catch {}
    for (const t of stream.getTracks()) t.stop()
  }
}

const MIC = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
const BLUETOOTH = /bluetooth|headset|hands-?free|airpods|buds|\bbt\b|sco\b/i

/**
 * Opens the phone's own mic, never a Bluetooth one: recording through a Bluetooth speaker or
 * headset switches it to the call profile (mono, different delay), which would change the
 * very delay being measured. Labels are only known once the mic was allowed once, so the
 * first time this may open the default mic, see it's Bluetooth, and reopen the built-in one.
 */
async function openMic() {
  const md = navigator.mediaDevices
  const pickBuiltIn = async () =>
    (await md.enumerateDevices()).find(
      (d) => d.kind === 'audioinput' && d.label && !BLUETOOTH.test(d.label) && d.deviceId !== 'default' && d.deviceId !== 'communications',
    )
  const open = (deviceId?: string) =>
    md.getUserMedia({ audio: deviceId ? { ...MIC, deviceId: { exact: deviceId } } : MIC }).catch(() => {
      throw new Error('microphone access refused')
    })
  const known = await pickBuiltIn().catch(() => undefined)
  let stream = await open(known?.deviceId)
  if (!known && BLUETOOTH.test(stream.getAudioTracks()[0]?.label ?? '')) {
    const builtIn = await pickBuiltIn()
    if (builtIn) {
      for (const t of stream.getTracks()) t.stop()
      await wait(1.5) // let the Bluetooth link fall back to music quality
      stream = await open(builtIn.deviceId)
    }
  }
  return stream
}

/** A short rising sweep (800 Hz → 5 kHz) with soft edges. */
function chirpBuffer(ctx: BaseAudioContext) {
  const sr = ctx.sampleRate
  const n = Math.round(CHIRP_SEC * sr)
  const buf = ctx.createBuffer(1, n, sr)
  const d = buf.getChannelData(0)
  const f0 = 800
  const k = Math.log(5000 / f0)
  const edge = 0.005 * sr
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const phase = ((2 * Math.PI * f0 * CHIRP_SEC) / k) * (Math.exp((t * k) / CHIRP_SEC) - 1)
    d[i] = 0.8 * Math.min(1, i / edge, (n - i) / edge) * Math.sin(phase)
  }
  return buf
}

function join(chunks: Float32Array[]) {
  const out = new Float32Array(chunks.reduce((s, c) => s + c.length, 0))
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

function rms(x: Float32Array) {
  let s = 0
  for (const v of x) s += v * v
  return Math.sqrt(s / Math.max(1, x.length))
}

/** Box average and keep one sample in `f` (a cheap low-pass is enough here). */
function decimate(x: Float32Array, f: number) {
  const out = new Float64Array(Math.floor(x.length / f))
  for (let i = 0; i < out.length; i++) {
    let s = 0
    for (let j = 0; j < f; j++) s += x[i * f + j]!
    out[i] = s / f
  }
  return out
}

/**
 * Lag (s) of `b` behind `a` (b(t) ≈ a(t − lag)), searched in [minLag, maxLag], and the
 * peak's height in standard deviations of the correlation over that range.
 */
export function gccPhat(a: Float32Array, b: Float32Array, sampleRate: number, minLag: number, maxLag: number, fLo: number, fHi: number) {
  const x = decimate(a, DOWN)
  const y = decimate(b, DOWN)
  const sr = sampleRate / DOWN
  let n = 1
  while (n < x.length + y.length) n <<= 1
  const ar = new Float64Array(n)
  const ai = new Float64Array(n)
  const br = new Float64Array(n)
  const bi = new Float64Array(n)
  ar.set(x)
  br.set(y)
  fft(ar, ai, false)
  fft(br, bi, false)
  for (let k = 0; k < n; k++) {
    const f = (k <= n / 2 ? k : n - k) * (sr / n)
    if (f < fLo || f > fHi) {
      ar[k] = ai[k] = 0
      continue
    }
    // B · conj(A), whitened
    const re = br[k]! * ar[k]! + bi[k]! * ai[k]!
    const im = bi[k]! * ar[k]! - br[k]! * ai[k]!
    const m = Math.hypot(re, im) || 1
    ar[k] = re / m
    ai[k] = im / m
  }
  fft(ar, ai, true)

  const lo = Math.round(minLag * sr)
  const hi = Math.round(maxLag * sr)
  const at = (l: number) => ar[(l + n) % n]!
  let best = lo
  let sum = 0
  let sum2 = 0
  for (let l = lo; l <= hi; l++) {
    const v = at(l)
    sum += v
    sum2 += v * v
    if (v > at(best)) best = l
  }
  const count = hi - lo + 1
  const mean = sum / count
  const sd = Math.sqrt(Math.max(1e-30, sum2 / count - mean * mean))
  // Parabolic interpolation around the peak.
  const p = at(best)
  const l1 = at(best - 1)
  const r1 = at(best + 1)
  const den = l1 - 2 * p + r1
  const frac = den < 0 ? (0.5 * (l1 - r1)) / den : 0
  return { lag: (best + frac) / sr, score: (p - mean) / sd }
}

/** In-place radix-2 FFT (inverse is scaled by 1/n). */
function fft(re: Float64Array, im: Float64Array, inverse: boolean) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b]! * cr - im[b]! * ci
        const ti = re[b]! * ci + im[b]! * cr
        re[b] = re[a]! - tr
        im[b] = im[a]! - ti
        re[a] = re[a]! + tr
        im[a] = im[a]! + ti
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) re[i] = re[i]! / n
}
