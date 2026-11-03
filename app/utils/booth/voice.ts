import type { VoicePreset } from '#shared/types/booth'
import { biquad, funfairReverb, gainNode, wav } from './dsp'

/**
 * The booth voice: your mic (Talkover, this device only) or a recorded pad, cleaned up
 * (low cut, presence, compressor), through a voice character (tannoy / robot / chipmunk /
 * monster), then a slapback and a funfair reverb.
 *
 *   mic ─▶ cleanup ─▶ notches ─▶ voice preset ─▶ gate ─▶ level ─┬─────────────────▶ out
 *                                                              └─ slapback + reverb ┘
 */

export const VOICE_PRESETS: VoicePreset[] = ['tannoy', 'robot', 'chipmunk', 'monster']

/** Slapback and reverb amounts: less tannoy room on the robot, a little less on the shifted voices. */
const ROOM: Record<VoicePreset, readonly [number, number]> = { tannoy: [0.35, 0.55], robot: [0.12, 0.25], chipmunk: [0.25, 0.4], monster: [0.25, 0.45] }
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
  } else {
    // Monster: down a tritone, more chest.
    const down = pitchShifter(ctx, -6)
    input.connect(down.input)
    down.output.connect(biquad(ctx, 'lowshelf', 220, Math.SQRT1_2, 7)).connect(output)
  }
  return { input, output }
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
 * listening stops, through the voice chain into `out`. A feedback detector notches larsen.
 */
export class VoiceChannel {
  private head: GainNode
  private gate: GainNode
  private level: GainNode
  private notches: BiquadFilterNode[]
  private nextNotch = 0
  private analyser: AnalyserNode
  private presetGains = {} as Record<VoicePreset, GainNode>
  private slapOut: GainNode
  private verbOut: GainNode
  private mic: MediaStream | null = null
  private micSrc: MediaStreamAudioSourceNode | null = null
  private micPending: Promise<void> | null = null
  private held = false
  private fbTimer: ReturnType<typeof setInterval> | undefined
  private fbCandidate = { bin: -1, count: 0 }

  constructor(private ctx: AudioContext, out: AudioNode) {
    this.head = gainNode(ctx)
    this.notches = Array.from({ length: MAX_NOTCHES }, () => biquad(ctx, 'notch', 20, 30)) // 20 Hz = idle
    const clean = voiceCleanup(ctx, this.notches)
    this.head.connect(clean.input)
    this.gate = gainNode(ctx, 0)
    this.level = gainNode(ctx)
    // Voice presets, crossfaded: only the chosen one is open.
    const presetsOut = gainNode(ctx)
    for (const p of VOICE_PRESETS) {
      this.presetGains[p] = gainNode(ctx, p === 'tannoy' ? 1 : 0)
      this.presetGains[p].connect(presetsOut)
    }
    for (const p of VOICE_PRESETS) {
      const v = voicePreset(ctx, p)
      clean.output.connect(v.input)
      v.output.connect(this.presetGains[p])
    }
    presetsOut.connect(this.gate).connect(this.level)
    ;({ slapOut: this.slapOut, verbOut: this.verbOut } = tannoyRoom(ctx, this.level, out))
    // Larsen watch: looks at the voice before the presets (a shifted pitch would put the
    // notch on the wrong frequency). Only read while Talkover is held.
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 4096
    this.analyser.smoothingTimeConstant = 0
    clean.output.connect(this.analyser)
  }

  private glide(p: AudioParam, v: number, tc: number) {
    p.setTargetAtTime(v, this.ctx.currentTime, tc)
  }

  setPreset(p: VoicePreset) {
    if (!VOICE_PRESETS.includes(p)) return
    for (const k of VOICE_PRESETS) this.glide(this.presetGains[k].gain, k === p ? 1 : 0, 0.03)
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
