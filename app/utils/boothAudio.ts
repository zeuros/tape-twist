/**
 * The booth, played in the browser (Web Audio) on top of the live stream, so pads and
 * effects react on the device you press. Two audio contexts:
 *  - music context (~60 ms output buffer, survives a phone being locked): the stream and
 *    what changes it — echo, EQ, colour, duck (these respond within ~60 ms);
 *  - fx context (lowest latency): pads and the mic voice, added on top (instant).
 *
 *   <audio> ─┬──────────────────────────────┬─▶ EQ ─┬─ dry ────────────────┬─▶ duck ─▶ limiter ─▶ out
 *            └─ echo send ─▶ ping-pong delay ┘      └─ colour ─▶ wet (+noise)┘
 *
 *   fx context:                          pads ─▶ pad gain ─────────────────────────┬─▶ limiter ─▶ out
 *   mic (talkover, this device only) ─▶ voice cleanup ─▶ feedback notches ─▶ gate ─┤
 *                                       slapback + funfair reverb (convolver) ◀───┘
 */

export type ColorPreset = 'off' | 'radio' | 'phone' | 'vinyl'
export interface Eq {
  low: number
  mid: number
  high: number
}
export interface PadInfo {
  id: string
  durationSec?: number
}

/**
 * Output buffer of the music context, in seconds. 'interactive' (~10–20 ms) crackled for a
 * couple of seconds when a phone was locked; this leaves room for that hiccup. The sync
 * accounts for it (outputLatency()).
 */
const MUSIC_LATENCY = 0.06
const EQ_MIN = -26 // slider bottom = kill (-40 dB)
const ECHO_DELAY = 0.375
const ECHO_FEEDBACK = 0.55
const dbToGain = (db: number) => Math.pow(10, db / 20)

interface Preset {
  filters: [BiquadFilterType, number, number?, number?][] // type, freq, Q, gain
  drive: number
  crackle: number // pop probability per sample
  hiss: number
  mono: number // 0 = stereo, 1 = mono
}
const PRESETS: Record<Exclude<ColorPreset, 'off'>, Preset> = {
  radio: {
    filters: [['highpass', 450], ['highpass', 450], ['lowpass', 3000], ['lowpass', 3000], ['peaking', 1500, 1.2, 5]],
    drive: 2.5, crackle: 0.0004, hiss: 0.012, mono: 0.85,
  },
  phone: {
    filters: [['highpass', 380], ['highpass', 380], ['lowpass', 3400], ['lowpass', 3400], ['peaking', 2000, 1, 4]],
    drive: 1.8, crackle: 0, hiss: 0.004, mono: 1,
  },
  vinyl: {
    filters: [['lowpass', 9000], ['highpass', 40], ['peaking', 120, 0.8, 2]],
    drive: 1.2, crackle: 0.0012, hiss: 0.006, mono: 0.2,
  },
}

export class BoothAudio {
  /** Music and everything that changes it (echo, EQ, colour, duck): a roomier output buffer. */
  readonly ctx: AudioContext
  /** Pads and voice, added on top: smallest output buffer, so they're instant. */
  readonly fx: AudioContext
  readonly musicIn: GainNode
  private master: AudioNode
  private sinkEl: HTMLAudioElement | null = null
  private sinkStream: MediaStreamAudioDestinationNode | null = null
  private eq: BiquadFilterNode[]
  private echoSend: GainNode
  private dry: GainNode
  private wet: GainNode
  private colorIn: GainNode
  private mono: GainNode[] // LL, RL, LR, RR
  private colorMerge: ChannelMergerNode
  private colorFilters: BiquadFilterNode[] = []
  private drive: WaveShaperNode
  private noise: AudioBufferSourceNode | null = null
  private wetSum: GainNode
  private duck: GainNode
  private padGain: GainNode
  private out: GainNode

  // Voice (talkover mic), mixed on this device only, after the duck.
  private voiceHead: GainNode
  private voiceGate: GainNode
  private voiceLevel: GainNode
  private notches: BiquadFilterNode[] = []
  private nextNotch = 0
  private analyser: AnalyserNode
  private mic: MediaStream | null = null
  private micSrc: MediaStreamAudioSourceNode | null = null
  private micPending: Promise<void> | null = null
  private voiceHeld = false
  private fbTimer: ReturnType<typeof setInterval> | undefined
  private fbCandidate = { bin: -1, count: 0 }

  private padBuffers = new Map<string, Promise<AudioBuffer | null>>()
  private voices = new Map<string, AudioBufferSourceNode>()
  private preset: ColorPreset = 'off'
  private duckDb = 10
  private talkover = false
  private echoHeld = false
  private echoOutTimer: ReturnType<typeof setTimeout> | undefined
  private echoOutOn = false

  /** Call from a tap (browsers only start audio after a user gesture). */
  constructor(el: HTMLAudioElement) {
    const ctx = (this.ctx = new AudioContext({ latencyHint: MUSIC_LATENCY }))
    const fx = (this.fx = new AudioContext({ latencyHint: 'interactive' }))
    const gain = (v = 1, c: BaseAudioContext = ctx) => {
      const g = c.createGain()
      g.gain.value = v
      return g
    }
    // The music comes in here: from the element (MP3 stream), or as scheduled PCM blocks.
    const src = (this.musicIn = gain())
    ctx.createMediaElementSource(el).connect(src)

    // Music sum: the stream plus the echo returns.
    const music = gain()
    src.connect(music)

    // Ping-pong echo: left repeats feed the right line and vice versa, darker and thinner each time.
    this.echoSend = gain(0)
    src.connect(this.echoSend)
    const split = ctx.createChannelSplitter(2)
    this.echoSend.connect(split)
    const merge = ctx.createChannelMerger(2)
    const lines = [0, 1].map((ch) => {
      const d = ctx.createDelay(1)
      d.delayTime.value = ECHO_DELAY
      split.connect(d, ch)
      d.connect(merge, 0, ch)
      return d
    })
    for (const [from, to] of [[0, 1], [1, 0]] as const) {
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 3500
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 250
      const fb = gain(ECHO_FEEDBACK)
      lines[from]!.connect(lp).connect(hp).connect(fb).connect(lines[to]!)
    }
    merge.connect(music)

    // Master EQ.
    this.eq = (
      [['lowshelf', 200], ['peaking', 1000], ['highshelf', 3500]] as [BiquadFilterType, number][]
    ).map(([type, f]) => {
      const b = ctx.createBiquadFilter()
      b.type = type
      b.frequency.value = f
      if (type === 'peaking') b.Q.value = 0.7
      b.gain.value = 0
      return b
    })
    music.connect(this.eq[0]!).connect(this.eq[1]!).connect(this.eq[2]!)

    // Colour: dry/wet crossfade; the wet path is mono-ish → filters → drive (+ crackle and hiss).
    this.duck = gain()
    this.dry = gain(1)
    this.wet = gain(0)
    this.eq[2]!.connect(this.dry).connect(this.duck)
    this.colorIn = gain()
    this.eq[2]!.connect(this.colorIn)
    const cSplit = ctx.createChannelSplitter(2)
    this.colorIn.connect(cSplit)
    this.colorMerge = ctx.createChannelMerger(2)
    this.mono = [0, 1].flatMap((inCh) =>
      [0, 1].map((outCh) => {
        const g = gain(inCh === outCh ? 1 : 0)
        cSplit.connect(g, inCh)
        g.connect(this.colorMerge, 0, outCh)
        return g
      }),
    )
    this.drive = ctx.createWaveShaper()
    this.wetSum = gain()
    this.drive.connect(this.wetSum)
    this.wetSum.connect(this.wet).connect(this.duck)
    this.colorMerge.connect(this.drive)

    // Music out; a soft limiter keeps it from clipping.
    this.out = gain()
    this.duck.connect(this.out)
    const pre = gain(0.5)
    const limiter = ctx.createWaveShaper()
    limiter.curve = softLimitCurve()
    this.out.connect(pre).connect(limiter).connect(ctx.destination)
    this.master = limiter

    // Instant side (low-latency context): pads and voice, added on top of the music.
    const fxOut = gain(1, fx)
    this.padGain = gain(0.8, fx)
    this.padGain.connect(fxOut)
    const fxLimiter = fx.createWaveShaper()
    fxLimiter.curve = softLimitCurve()
    fxOut.connect(gain(0.5, fx)).connect(fxLimiter).connect(fx.destination)

    // Voice: cleanup (cut the boomy lows that feed back first, add presence, tame peaks),
    // a gate opened while Talkover is held here, then dry + slapback + funfair reverb.
    this.voiceHead = gain(1, fx)
    const hp1 = biquad(fx, 'highpass', 170)
    const hp2 = biquad(fx, 'highpass', 170)
    this.notches = Array.from({ length: MAX_NOTCHES }, () => biquad(fx, 'notch', 20, 30)) // 20 Hz = idle
    const presence = biquad(fx, 'peaking', 2800, 0.9, 5)
    const top = biquad(fx, 'lowpass', 7500)
    const comp = fx.createDynamicsCompressor()
    comp.threshold.value = -26
    comp.ratio.value = 6
    comp.attack.value = 0.003
    comp.release.value = 0.15
    comp.knee.value = 6
    this.voiceGate = gain(0, fx)
    this.voiceLevel = gain(1, fx)
    let node: AudioNode = this.voiceHead.connect(hp1).connect(hp2)
    for (const n of this.notches) node = node.connect(n)
    node.connect(presence).connect(top).connect(comp).connect(this.voiceGate).connect(this.voiceLevel)
    this.voiceLevel.connect(fxOut) // dry
    // Slapback: the tannoy bouncing off the stalls.
    const slap = fx.createDelay(1)
    slap.delayTime.value = 0.13
    const slapFb = gain(0.3, fx)
    const slapTone = biquad(fx, 'lowpass', 3000)
    this.voiceLevel.connect(slap)
    slap.connect(slapTone).connect(slapFb).connect(slap)
    const slapOut = gain(0.35, fx)
    slapTone.connect(slapOut).connect(fxOut)
    // Big bright plate-ish reverb.
    const verb = fx.createConvolver()
    verb.buffer = funfairReverb(fx)
    const verbOut = gain(0.55, fx)
    this.voiceLevel.connect(verb)
    slapOut.connect(verb)
    verb.connect(verbOut).connect(fxOut)
    // Larsen watch: looks at the voice before the effects.
    this.analyser = fx.createAnalyser()
    this.analyser.fftSize = 4096
    this.analyser.smoothingTimeConstant = 0
    this.voiceGate.connect(this.analyser)
  }

  resume() {
    return Promise.all([this.ctx.resume(), this.fx.resume()])
  }

  /**
   * Send the final mix out through a hidden <audio> element instead of straight to the
   * speaker. Mobile browsers (Firefox on Android) only keep a page playing with the screen
   * off when a media element is playing; pure Web Audio is suspended. Call `true` from a tap.
   */
  playThroughElement(on: boolean) {
    if (on === !!this.sinkEl) {
      if (on) void this.sinkEl!.play().catch(() => {})
      return
    }
    if (on) {
      this.sinkStream ??= this.ctx.createMediaStreamDestination()
      const el = (this.sinkEl = new Audio())
      el.srcObject = this.sinkStream.stream
      this.master.disconnect()
      this.master.connect(this.sinkStream)
      void el.play().catch(() => {})
    } else {
      this.sinkEl!.pause()
      this.sinkEl!.srcObject = null
      this.sinkEl = null
      this.master.disconnect()
      this.master.connect(this.ctx.destination)
    }
  }

  /** Seconds between this page's audio and the speaker (for sync). */
  outputLatency() {
    const c = this.ctx as AudioContext & { outputLatency?: number }
    return (c.outputLatency || 0) + (c.baseLatency || 0)
  }

  close() {
    if (this.sinkEl) this.playThroughElement(false)
    this.stopPads()
    this.closeMic()
    void this.ctx.close()
    void this.fx.close()
  }

  /** Glide from wherever the param is now (a new target simply takes over from the old one). */
  private glide(p: AudioParam, v: number, tc: number, c: BaseAudioContext = this.ctx) {
    p.setTargetAtTime(v, c.currentTime, tc)
  }

  // ------------------------------------------------------------------ EQ

  setEq(eq: Eq) {
    const db = (v: number) => (v <= EQ_MIN ? -40 : v)
    this.glide(this.eq[0]!.gain, db(eq.low), 0.02)
    this.glide(this.eq[1]!.gain, db(eq.mid), 0.02)
    this.glide(this.eq[2]!.gain, db(eq.high), 0.02)
  }

  // -------------------------------------------------------------- colour

  setColor(p: ColorPreset) {
    if (p === this.preset) return
    this.preset = p
    const tc = 0.1 // ~330 ms glide
    this.glide(this.wet.gain, p === 'off' ? 0 : 1, tc)
    this.glide(this.dry.gain, p === 'off' ? 1 : 0, tc)
    if (p === 'off') return // the old colour fades out, then just sits there silent
    const pr = PRESETS[p]
    // Mono amount: L' = L·(1-m/2) + R·(m/2).
    const same = 1 - pr.mono / 2
    const cross = pr.mono / 2
    this.mono.forEach((g, i) => (g.gain.value = i === 0 || i === 3 ? same : cross))
    // Filters.
    this.colorMerge.disconnect()
    for (const f of this.colorFilters) f.disconnect()
    this.colorFilters = pr.filters.map(([type, freq, q, gain]) => {
      const b = this.ctx.createBiquadFilter()
      b.type = type
      b.frequency.value = freq
      b.Q.value = q ?? Math.SQRT1_2
      if (gain) b.gain.value = gain
      return b
    })
    let node: AudioNode = this.colorMerge
    for (const f of this.colorFilters) node = node.connect(f)
    node.connect(this.drive)
    this.drive.curve = driveCurve(pr.drive)
    // Crackle and hiss.
    this.noise?.stop()
    this.noise = this.ctx.createBufferSource()
    this.noise.buffer = noiseBuffer(this.ctx, pr.crackle, pr.hiss)
    this.noise.loop = true
    this.noise.connect(this.wetSum)
    this.noise.start()
  }

  // ---------------------------------------------------- duck, echo, pads

  setDuckDb(db: number) {
    this.duckDb = db
    this.updateDuck()
  }

  setTalkover(on: boolean) {
    this.talkover = on
    this.updateDuck()
  }

  private updateDuck() {
    const engaged = this.talkover || this.voices.size > 0
    // Fast attack, slower release.
    this.glide(this.duck.gain, engaged ? dbToGain(-Math.abs(this.duckDb)) : 1, engaged ? 0.02 : 0.15)
  }

  setEcho(on: boolean) {
    this.echoHeld = on
    this.updateEcho()
  }

  /**
   * Echo out: the server cuts the track ~0.7 s after the tap, and the cut reaches this
   * device `lagSec` later. Keep the echo send open until then, so the tail rings over the gap.
   */
  echoOut(lagSec: number) {
    clearTimeout(this.echoOutTimer)
    this.echoOutOn = true
    this.updateEcho()
    this.echoOutTimer = setTimeout(() => {
      this.echoOutOn = false
      this.updateEcho()
    }, (0.7 + lagSec) * 1000)
  }

  private updateEcho() {
    this.glide(this.echoSend.gain, this.echoHeld || this.echoOutOn ? 1 : 0, 0.015)
  }

  setPadVolume(v: number) {
    this.glide(this.padGain.gain, v, 0.02, this.fx)
  }

  /** Fetch and decode the pads now, so the first tap is instant. */
  loadPads(list: PadInfo[]) {
    for (const p of list) if (!this.padBuffers.has(p.id)) this.padBuffers.set(p.id, this.decodePad(p.id))
  }

  private async decodePad(id: string) {
    try {
      const data = await (await fetch(`/api/pads/${encodeURIComponent(id)}`)).arrayBuffer()
      const buf = await this.fx.decodeAudioData(data)
      // Peak-normalise so a quiet "bruh" and a loud airhorn sit at the same level.
      let peak = 0
      for (let c = 0; c < buf.numberOfChannels; c++) for (const x of buf.getChannelData(c)) peak = Math.max(peak, Math.abs(x))
      if (peak > 0) {
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const d = buf.getChannelData(c)
          for (let i = 0; i < d.length; i++) d[i]! *= 0.85 / peak
        }
      }
      return buf
    } catch (e) {
      console.error('[pads]', id, e)
      this.padBuffers.delete(id) // retry on the next tap
      return null
    }
  }

  isPlaying(id: string) {
    return this.voices.has(id)
  }

  /** Start (or restart) a pad, or stop it. */
  async pad(id: string, on: boolean) {
    this.voices.get(id)?.stop()
    this.voices.delete(id)
    if (!on) return this.updateDuck()
    if (!this.padBuffers.has(id)) this.padBuffers.set(id, this.decodePad(id))
    const buf = await this.padBuffers.get(id)
    if (!buf) return
    if (this.voices.size >= 8) this.voices.values().next().value?.stop()
    const s = this.fx.createBufferSource()
    s.buffer = buf
    s.connect(this.padGain)
    s.onended = () => {
      if (this.voices.get(id) === s) this.voices.delete(id)
      this.updateDuck()
    }
    this.voices.set(id, s)
    s.start()
    this.updateDuck()
  }

  stopPads() {
    for (const s of this.voices.values()) s.stop()
    this.voices.clear()
    this.updateDuck()
  }

  // --------------------------------------------------------------- voice

  setVoiceVolume(v: number) {
    this.glide(this.voiceLevel.gain, v, 0.02, this.fx)
  }

  /**
   * Talkover held on this device: open the mic into the mix (asks for the microphone the
   * first time; it then stays open until listening stops). Throws if the mic is unavailable.
   */
  async voice(on: boolean) {
    this.voiceHeld = on
    if (on && !this.micSrc) {
      this.micPending ??= this.openMic().finally(() => (this.micPending = null))
      await this.micPending
    }
    const open = this.voiceHeld && !!this.micSrc
    this.glide(this.voiceGate.gain, open ? 1 : 0, open ? 0.01 : 0.06, this.fx)
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
    this.micSrc = this.fx.createMediaStreamSource(this.mic)
    this.micSrc.connect(this.voiceHead)
  }

  closeMic() {
    this.voiceHeld = false
    clearInterval(this.fbTimer)
    this.voiceGate.gain.value = 0
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
    const hz = this.fx.sampleRate / a.fftSize
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

const MAX_NOTCHES = 6

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = Math.SQRT1_2, gainDb = 0) {
  const b = ctx.createBiquadFilter()
  b.type = type
  b.frequency.value = f
  b.Q.value = q
  b.gain.value = gainDb
  return b
}

/** Fairground tannoy reverb: early slaps off the stalls, then a long bright tail (2.6 s). */
function funfairReverb(ctx: AudioContext) {
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

/** Transparent below 0.9, soft-saturates above, never exceeds 1. Input pre-scaled by 0.5. */
function softLimitCurve() {
  const n = 4097
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2
    const a = Math.abs(x)
    c[i] = a > 0.9 ? Math.sign(x) * (0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1)) : x
  }
  return c
}

function driveCurve(drive: number) {
  const n = 2049
  const c = new Float32Array(n)
  const norm = Math.tanh(drive)
  for (let i = 0; i < n; i++) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * drive) / norm
  return c
}

/** 4 s loop of vinyl crackle (random decaying pops) and soft hiss. */
function noiseBuffer(ctx: AudioContext, crackle: number, hiss: number) {
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
