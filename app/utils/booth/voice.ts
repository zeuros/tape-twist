import type { VoicePreset } from '#shared/types/booth'
import { biquad, driveCurve, funfairReverb, gainNode, wav } from './dsp'
import voiceWorkletUrl from '../../workers/voice.worklet.ts?worker&url'

/** The voice worklets' module (auto-tune, and Talkover to the other devices), loaded once per context. */
const loaded = new WeakMap<BaseAudioContext, Promise<void>>()
export function addVoiceModule(ctx: BaseAudioContext) {
  let p = loaded.get(ctx)
  if (!p) loaded.set(ctx, (p = ctx.audioWorklet.addModule(voiceWorkletUrl)))
  return p
}

/**
 * The booth voice: your mic (Talkover, also sent to the other devices) or a recorded pad, cleaned up
 * (low cut, presence, compressor), through a voice character (tannoy / robot / chipmunk /
 * monster / megaphone / vocoder / auto-tune / underwater), then a slapback and a funfair reverb.
 *
 *   mic ─▶ cleanup ─▶ notches ─▶ voice preset ─▶ gate ─▶ level ─┬─────────────────▶ out
 *                                                              └─ slapback + reverb ┘
 */

export const VOICE_PRESETS: VoicePreset[] = ['tannoy', 'robot', 'chipmunk', 'monster', 'megaphone', 'vocoder', 'autotune', 'underwater']

/** Slapback and reverb amounts: less tannoy room on the robot, a little less on the shifted voices. */
const ROOM: Record<VoicePreset, readonly [number, number]> = {
  tannoy: [0.35, 0.55],
  robot: [0.12, 0.25],
  chipmunk: [0.25, 0.4],
  monster: [0.25, 0.45],
  megaphone: [0.3, 0.3], // a street, not a hall
  vocoder: [0.15, 0.35],
  autotune: [0.2, 0.35],
  underwater: [0.05, 0.6], // all reverb, no slap
}
const MAX_NOTCHES = 6

/** Low cut (feeds back first), optional larsen notches, presence, top cut, compressor. */
function voiceCleanup(ctx: BaseAudioContext, notches: BiquadFilterNode[] = []) {
  const input = biquad(ctx, 'highpass', 170)
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -26
  comp.ratio.value = 6
  comp.attack.value = 0.003
  comp.release.value = 0.15
  comp.knee.value = 6
  let node: AudioNode = input.connect(biquad(ctx, 'highpass', 170))
  for (const n of notches) node = node.connect(n)
  node.connect(biquad(ctx, 'peaking', 2800, 0.9, 5)).connect(biquad(ctx, 'lowpass', 7500)).connect(comp)
  return { input, output: comp }
}

/** Dry voice plus the tannoy bouncing off the stalls (slapback) and a big bright reverb. */
function tannoyRoom(ctx: BaseAudioContext, voice: AudioNode, out: AudioNode, [slapAmt, verbAmt] = ROOM.tannoy) {
  voice.connect(out) // dry
  const slap = ctx.createDelay(1)
  slap.delayTime.value = 0.13
  const slapFb = gainNode(ctx, 0.3)
  const slapTone = biquad(ctx, 'lowpass', 3000)
  voice.connect(slap)
  slap.connect(slapTone).connect(slapFb).connect(slap)
  const slapOut = gainNode(ctx, slapAmt)
  slapTone.connect(slapOut).connect(out)
  const verb = ctx.createConvolver()
  verb.buffer = funfairReverb(ctx)
  const verbOut = gainNode(ctx, verbAmt)
  voice.connect(verb)
  slapOut.connect(verb)
  verb.connect(verbOut).connect(out)
  return { slapOut, verbOut }
}

/** One voice character, between the cleaned-up voice and the room. */
function voicePreset(ctx: BaseAudioContext, p: VoicePreset) {
  const input = ctx.createGain()
  const output = ctx.createGain()
  if (p === 'tannoy') {
    input.connect(output)
  } else if (p === 'robot') {
    // Ring modulation (voice × 60 Hz sine) into a short metallic comb.
    const ring = gainNode(ctx, 0)
    const carrier = ctx.createOscillator()
    carrier.frequency.value = 60
    carrier.connect(ring.gain)
    carrier.start()
    const comb = ctx.createDelay(0.05)
    comb.delayTime.value = 0.008
    const combFb = gainNode(ctx, 0.55)
    input.connect(ring).connect(comb).connect(combFb).connect(comb)
    ring.connect(output)
    comb.connect(output)
  } else if (p === 'chipmunk') {
    // Up a fifth.
    const up = pitchShifter(ctx, 7)
    input.connect(up.input)
    up.output.connect(output)
  } else if (p === 'monster') {
    // Down a tritone, more chest.
    const down = pitchShifter(ctx, -6)
    input.connect(down.input)
    down.output.connect(biquad(ctx, 'lowshelf', 220, Math.SQRT1_2, 7)).connect(output)
  } else if (p === 'megaphone') {
    megaphone(ctx, input, output)
  } else if (p === 'vocoder') {
    vocoder(ctx, input, output)
  } else if (p === 'autotune') {
    // The worklet's module loads in the background: silent until then (`ready` for offline renders).
    const ready = addVoiceModule(ctx).then(() => {
      input.connect(new AudioWorkletNode(ctx, 'voice-autotune', { outputChannelCount: [1] })).connect(output)
    })
    return { input, output, ready }
  } else {
    underwater(ctx, input, output)
  }
  return { input, output, ready: Promise.resolve() }
}

/** A loudhailer: a narrow, honky band, driven into distortion, then cut again. */
function megaphone(ctx: BaseAudioContext, input: AudioNode, output: AudioNode) {
  const drive = ctx.createWaveShaper()
  drive.curve = driveCurve(5)
  drive.oversample = '2x'
  input
    .connect(gainNode(ctx, 2.5))
    .connect(biquad(ctx, 'highpass', 550, 0.9))
    .connect(biquad(ctx, 'peaking', 1700, 1.2, 9))
    .connect(drive)
    .connect(biquad(ctx, 'lowpass', 3800, 1.1))
    .connect(biquad(ctx, 'highpass', 450))
    .connect(gainNode(ctx, 0.2)) // the distortion is dense: as loud as the tannoy at a lower peak
    .connect(output)
}

/** The vocoder's chord (A minor, low): the voice "plays" it. */
const VOCODER_NOTES = [110, 164.81, 220, 261.63, 329.63]
const VOCODER_BANDS = 16

/**
 * Channel vocoder: the voice is split into 16 bands; each band's level (rectified, smoothed)
 * opens the same band of a sawtooth chord, so the chord speaks with the voice's vowels. A
 * little of the voice's top (the s and t) is mixed back in, or the words get hard to follow.
 */
function vocoder(ctx: BaseAudioContext, input: AudioNode, output: AudioNode) {
  const carrier = gainNode(ctx, 1 / VOCODER_NOTES.length)
  for (const [i, f] of VOCODER_NOTES.entries()) {
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = f
    o.detune.value = (i % 2 ? 1 : -1) * 6 // a little width
    o.connect(carrier)
    o.start()
  }
  const rectify = new Float32Array(1025).map((_, i) => Math.abs(i / 512 - 1))
  const bandsOut = gainNode(ctx, 1)
  const lo = 140
  const hi = 6500
  for (let b = 0; b < VOCODER_BANDS; b++) {
    const f = lo * Math.pow(hi / lo, b / (VOCODER_BANDS - 1))
    const q = 7
    // Voice band → level.
    const env = ctx.createWaveShaper()
    env.curve = rectify
    input.connect(biquad(ctx, 'bandpass', f, q)).connect(env)
    const smooth = biquad(ctx, 'lowpass', 35)
    env.connect(smooth)
    // Chord band, opened by that level (the gain's own value is 0: only the level counts).
    const vca = gainNode(ctx, 0)
    smooth.connect(gainNode(ctx, VOCODER_GAIN)).connect(vca.gain)
    carrier.connect(biquad(ctx, 'bandpass', f, q)).connect(vca).connect(bandsOut)
  }
  bandsOut.connect(output)
  input.connect(biquad(ctx, 'highpass', 5000)).connect(gainNode(ctx, 0.5)).connect(output)
}
/** How far a band's level opens its chord band (tuned so the vocoder is as loud as the tannoy). */
const VOCODER_GAIN = 23

/** Under water: muffled, wobbling (a slow, deep chorus) and bubbling (a dark, swirling echo). */
function underwater(ctx: BaseAudioContext, input: AudioNode, output: AudioNode) {
  const muffled = biquad(ctx, 'lowpass', 650, 3)
  input.connect(biquad(ctx, 'peaking', 350, 1, 4)).connect(muffled)
  const wobble = (rate: number, depth: number, base: number) => {
    const d = ctx.createDelay(0.1)
    d.delayTime.value = base
    const lfo = ctx.createOscillator()
    lfo.frequency.value = rate
    lfo.connect(gainNode(ctx, depth)).connect(d.delayTime)
    lfo.start()
    return d
  }
  for (const [rate, depth, base] of [[0.9, 0.006, 0.02], [1.37, 0.008, 0.028]] as const) {
    muffled.connect(wobble(rate, depth, base)).connect(gainNode(ctx, 0.5)).connect(output)
  }
  const bubbles = wobble(3.1, 0.004, 0.07)
  const fb = gainNode(ctx, 0.45)
  muffled.connect(bubbles).connect(biquad(ctx, 'lowpass', 500)).connect(fb).connect(bubbles)
  fb.connect(gainNode(ctx, 0.5)).connect(output)
  muffled.connect(gainNode(ctx, 0.35)).connect(output)
}

/**
 * Pitch shifter built from plain nodes: two delay lines whose length sweeps at a constant
 * rate (that rate is the speed change), each faded in and out, half a cycle apart, so one
 * is always mid-sweep while the other jumps back. ~0.1 s of delay: fine for a voice.
 */
function pitchShifter(ctx: BaseAudioContext, semitones: number) {
  const ratio = Math.pow(2, semitones / 12)
  const win = 0.1
  const period = win / Math.abs(1 - ratio)
  const len = Math.max(2, Math.round(period * ctx.sampleRate))
  // Channel 0: delay sweep (shrinking for up, growing for down); channel 1: fade window.
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  const sweep = buf.getChannelData(0)
  const fade = buf.getChannelData(1)
  for (let i = 0; i < len; i++) {
    const ph = i / len
    sweep[i] = 0.005 + win * (ratio > 1 ? 1 - ph : ph)
    fade[i] = Math.sin(Math.PI * ph)
  }
  const input = ctx.createGain()
  const output = ctx.createGain()
  const t = ctx.currentTime + 0.05
  for (const offset of [0, period / 2]) {
    const d = ctx.createDelay(win + 0.05)
    d.delayTime.value = 0
    const g = gainNode(ctx, 0)
    const lfo = ctx.createBufferSource()
    lfo.buffer = buf
    lfo.loop = true
    const split = ctx.createChannelSplitter(2)
    lfo.connect(split)
    split.connect(d.delayTime, 0)
    split.connect(g.gain, 1)
    lfo.start(t, offset)
    input.connect(d).connect(g).connect(output)
  }
  return { input, output }
}

/**
 * Talkover voice on this device: the mic, opened on the first press and kept open until
 * listening stops, through the voice chain into `out` (and `bus`, sent to the other devices). A feedback detector notches larsen.
 */
export class VoiceChannel {
  private head: GainNode
  private gate: GainNode
  private level: GainNode
  private notches: BiquadFilterNode[]
  private nextNotch = 0
  private analyser: AnalyserNode
  private clean: { input: AudioNode; output: AudioNode }
  private presetsOut: GainNode
  /** Each voice character, built the first time it's picked; only the chosen one gets the voice. */
  private presets = new Map<VoicePreset, { input: AudioNode; gain: GainNode }>()
  private preset: VoicePreset | null = null
  private slapOut: GainNode
  private verbOut: GainNode
  private mic: MediaStream | null = null
  private micSrc: MediaStreamAudioSourceNode | null = null
  private micPending: Promise<void> | null = null
  private held = false
  private fbTimer: ReturnType<typeof setInterval> | undefined
  private fbCandidate = { bin: -1, count: 0 }
  /** The whole voice (room included), also sent to the other devices (app/utils/voiceLink.ts). */
  readonly bus: GainNode
  /** Told when the voice opens (true) and closes (false), to send it while open. */
  onOpen: (open: boolean) => void = () => {}

  constructor(private ctx: AudioContext, out: AudioNode) {
    this.head = gainNode(ctx)
    this.notches = Array.from({ length: MAX_NOTCHES }, () => biquad(ctx, 'notch', 20, 30)) // 20 Hz = idle
    const clean = (this.clean = voiceCleanup(ctx, this.notches))
    this.head.connect(clean.input)
    this.gate = gainNode(ctx, 0)
    this.level = gainNode(ctx)
    this.presetsOut = gainNode(ctx)
    this.presetsOut.connect(this.gate).connect(this.level)
    this.bus = gainNode(ctx)
    this.bus.connect(out)
    ;({ slapOut: this.slapOut, verbOut: this.verbOut } = tannoyRoom(ctx, this.level, this.bus))
    // Larsen watch: looks at the voice before the presets (a shifted pitch would put the
    // notch on the wrong frequency). Only read while Talkover is held.
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 4096
    this.analyser.smoothingTimeConstant = 0
    clean.output.connect(this.analyser)
    this.setPreset('tannoy')
  }

  private glide(p: AudioParam, v: number, tc: number) {
    p.setTargetAtTime(v, this.ctx.currentTime, tc)
  }

  /** Crossfades to voice character `p`; the previous one is cut off once faded (no CPU left on it). */
  setPreset(p: VoicePreset) {
    if (!VOICE_PRESETS.includes(p) || p === this.preset) return
    let next = this.presets.get(p)
    if (!next) {
      const v = voicePreset(this.ctx, p)
      const gain = gainNode(this.ctx, 0)
      v.output.connect(gain).connect(this.presetsOut)
      this.presets.set(p, (next = { input: v.input, gain }))
    }
    this.clean.output.connect(next.input)
    this.glide(next.gain.gain, 1, 0.03)
    const prevName = this.preset
    const prev = prevName && this.presets.get(prevName)
    if (prev) {
      this.glide(prev.gain.gain, 0, 0.03)
      setTimeout(() => {
        if (this.preset === prevName) return // picked again meanwhile
        try {
          this.clean.output.disconnect(prev.input)
        } catch {
          /* already */
        }
      }, 300)
    }
    this.preset = p
    const [slap, verb] = ROOM[p]
    this.glide(this.slapOut.gain, slap, 0.03)
    this.glide(this.verbOut.gain, verb, 0.03)
  }

  setVolume(v: number) {
    this.glide(this.level.gain, v, 0.02)
  }

  /** Open the mic into the mix while held (asks for it the first time). Throws if unavailable. */
  async hold(on: boolean) {
    this.held = on
    if (on && !this.micSrc) {
      this.micPending ??= this.openMic().finally(() => (this.micPending = null))
      await this.micPending
    }
    const open = this.held && !!this.micSrc
    this.glide(this.gate.gain, open ? 1 : 0, open ? 0.01 : 0.06)
    this.onOpen(open)
    clearInterval(this.fbTimer)
    if (open) this.fbTimer = setInterval(() => this.watchFeedback(), 50)
  }

  private async openMic() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(window.isSecureContext ? 'No microphone API in this browser.' : 'The microphone needs HTTPS: open the https:// address (npm run dev:https).')
    }
    // Echo cancellation removes this device's own output from the mic: the first defence
    // against larsen when this device drives the speakers.
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 },
    })
    this.micSrc = this.ctx.createMediaStreamSource(this.mic)
    this.micSrc.connect(this.head)
  }

  closeMic() {
    this.held = false
    this.onOpen(false)
    clearInterval(this.fbTimer)
    this.gate.gain.value = 0
    this.micSrc?.disconnect()
    this.micSrc = null
    for (const t of this.mic?.getTracks() ?? []) t.stop()
    this.mic = null
  }

  /**
   * Feedback destroyer: larsen is one pure tone growing louder, unlike speech whose
   * peaks move. A peak towering over the rest of the spectrum at the same frequency for
   * ~200 ms gets a narrow notch (up to 6, kept for the evening: the room doesn't change).
   */
  private watchFeedback() {
    const a = this.analyser
    const data = new Float32Array(a.frequencyBinCount)
    a.getFloatFrequencyData(data)
    const hz = this.ctx.sampleRate / a.fftSize
    const lo = Math.floor(150 / hz)
    const hi = Math.min(data.length - 1, Math.ceil(9000 / hz))
    let peak = lo
    let sum = 0
    for (let i = lo; i <= hi; i++) {
      sum += data[i]!
      if (data[i]! > data[peak]!) peak = i
    }
    const mean = sum / (hi - lo + 1)
    const tonal = data[peak]! > -35 && data[peak]! - mean > 38
    const c = this.fbCandidate
    if (tonal && Math.abs(peak - c.bin) <= 1) c.count++
    else {
      c.bin = tonal ? peak : -1
      c.count = tonal ? 1 : 0
    }
    if (c.count < 4) return
    // Parabolic interpolation between bins (~12 Hz apart): the notch is only ~30 Hz wide.
    const [y0, y1, y2] = [data[peak - 1]!, data[peak]!, data[peak + 1]!]
    const den = y0 - 2 * y1 + y2
    const f = (peak + (den ? (0.5 * (y0 - y2)) / den : 0)) * hz
    c.bin = -1
    c.count = 0
    const existing = this.notches.find((n) => Math.abs(n.frequency.value - f) < f * 0.03)
    if (existing) {
      existing.Q.value = Math.max(8, existing.Q.value / 1.6) // still ringing: widen it
      return
    }
    const n = this.notches[this.nextNotch++ % this.notches.length]!
    n.frequency.value = f
    n.Q.value = 30
    console.info(`[booth] larsen at ${Math.round(f)} Hz: notched`)
  }
}

/**
 * A recorded pad with this device's voice: cleanup, preset, slapback and funfair reverb,
 * rendered offline (no live audio needed). Returns a mono 16-bit WAV.
 */
export async function renderVoicePad(recording: Blob, p: VoicePreset): Promise<Blob> {
  const rate = 48000
  const src = await new OfflineAudioContext(1, rate, rate).decodeAudioData(await recording.arrayBuffer())
  const tail = 1.5
  const ctx = new OfflineAudioContext(1, Math.ceil((src.duration + tail) * rate), rate)
  const player = ctx.createBufferSource()
  player.buffer = src
  const clean = voiceCleanup(ctx)
  player.connect(clean.input)
  const v = voicePreset(ctx, p)
  clean.output.connect(v.input)
  await v.ready
  // The tail fades out so the reverb doesn't end in a cut.
  const out = ctx.createGain()
  const end = src.duration + tail
  out.gain.setValueAtTime(1, end - 0.6)
  out.gain.linearRampToValueAtTime(0, end)
  out.connect(ctx.destination)
  tannoyRoom(ctx, v.output, out, ROOM[p])
  player.start()
  return wav(await ctx.startRendering())
}
