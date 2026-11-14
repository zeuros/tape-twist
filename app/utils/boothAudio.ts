/**
 * The booth, played in the browser (Web Audio) on top of the live stream, so pads and
 * effects react on the device you press. Two audio contexts:
 *  - music context (~60 ms output buffer, survives a phone being locked): the stream and
 *    what changes it — echo, EQ, colour, duck (these respond within ~60 ms);
 *  - fx context (lowest latency): pads and the mic voice, added on top (instant).
 *
 *   stream ─▶ pitch ─▶ brake ─▶ rewind ─▶ stutter ─┬──────────────────────────────┬─▶ EQ ─▶ XY filter ─▶ build-up high-pass ─┐
 *    (two sweeping (tape-stop  (reverse   (looping └─ echo send ─▶ ping-pong delay ┘                                          │
 *     delay taps)   delay)      delay)     delay)                                                                         │
 *     ┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *     └┬─ dry ────────────────┬─▶ duck ─▶ out (+ build-up riser, snare roll, drop) ─▶ limiter ─▶ speaker
 *      └─ colour ─▶ wet (+noise)┘                └─▶ kick meter (light show)
 *
 *   fx context:                          pads ─▶ pad gain ─────────────────────────┬─▶ limiter ─▶ out
 *   mic (talkover, this device only) ─▶ voice chain (app/utils/booth/voice.ts) ─────┘
 */

import type { ColorPreset, Eq, VoicePreset, XY } from '#shared/types/booth'
import { biquad, dbToGain, driveCurve, gainNode, noiseBuffer, softLimitCurve } from './booth/dsp'
import { measureRoom } from './booth/autoSync'
import { VoiceChannel } from './booth/voice'
import { MusicPitch } from './booth/pitch'

export interface PadInfo {
  id: string
  durationSec?: number
}

/**
 * Output buffer of the music context, in seconds. Chromium's whole output delay grows with it
 * (desktop: 0.06 → 61 + 240 ms, 0.02 → 21 + 136 ms) and comes out of SYNC_DELAY's margin, so
 * keep it small. 'interactive' (~10 ms) crackled for a couple of seconds when a phone was locked;
 * 0.02 leaves room for that hiccup. Firefox ignores it. The sync accounts for it (outputLatency).
 */
const MUSIC_LATENCY = 0.02
const EQ_MIN = -26 // slider bottom = kill (-40 dB)
const ECHO_DELAY = 0.375
const ECHO_FEEDBACK = 0.55
const BRAKE_SEC = 1.2 // turntable losing power: full speed to standstill
const SPINUP_SEC = 0.35 // back to live, faster than real time
const REWIND_ACCEL_SEC = 0.5 // from playing forward to full reverse
const REWIND_RATE = 4 // delay growth at full reverse: plays backwards at 3× speed
const REWIND_MAX = 15 // s of music it can rewind through, then it fades out
const BUILD_BEATS = 16 // four bars from the press to the full build-up

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
  private keepAliveEl: HTMLAudioElement | null = null
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
  private pitch: MusicPitch
  private brakeDelay: DelayNode
  private brakeGain: GainNode
  private rewindDelay: DelayNode
  private rewindGain: GainNode
  private stDry: GainNode
  private stCap: GainNode
  private stDelay: DelayNode
  private stFb: GainNode
  private stWet: GainNode
  private buildHp: BiquadFilterNode
  private kickMeter: AnalyserNode
  private kickBuf = new Float32Array(1024)
  private djLp: BiquadFilterNode
  private djHp: BiquadFilterNode
  private echoFb: GainNode[] = []
  private xyEcho = 0
  private padGain: GainNode
  private out: GainNode
  private head: GainNode
  private syncMute: GainNode
  private preOut: GainNode

  /** Talkover mic, mixed on this device only, after the duck. */
  private talk: VoiceChannel

  private padBuffers = new Map<string, Promise<AudioBuffer | null>>()
  private voices = new Map<string, AudioBufferSourceNode>()
  private preset: ColorPreset = 'off'
  private duckDb = 10
  private talkover = false
  private echoHeld = false

  /**
   * Call from a tap (browsers only start audio after a user gesture). The live player's
   * AudioWorklet plays the stream into `musicIn` (app/utils/liveAudio.ts).
   */
  constructor() {
    // At the stream's own rate: if the phone's speaker runs at 44.1 kHz, the browser's own
    // resampler converts at the output, better than the player's linear interpolation.
    // Not in Firefox: it won't connect the mic (auto-sync) to a context at another rate than the
    // device's.
    const firefox = /firefox/i.test(navigator.userAgent)
    const ctx = (this.ctx = new AudioContext({ latencyHint: MUSIC_LATENCY, ...(firefox ? {} : { sampleRate: 48000 }) }))
    const fx = (this.fx = new AudioContext({ latencyHint: 'interactive' }))
    const gain = (v = 1, c: BaseAudioContext = ctx) => gainNode(c, v)
    // The music comes in here, from the live player's AudioWorklet (app/utils/liveAudio.ts).
    const src = (this.musicIn = gain())

    // Tape stop: a delay whose length grows ever faster slows the music down to a standstill
    // (and lowers its pitch with it); shrinking it back to 0 plays catch-up, then it's live again.
    this.brakeDelay = ctx.createDelay(2)
    this.brakeDelay.delayTime.value = 0
    this.brakeGain = gain()
    const head = (this.head = gain())
    // Pitch buttons: bend the music's key while held, keeping its timing (app/utils/booth/pitch.ts).
    this.pitch = new MusicPitch(ctx)
    src.connect(this.pitch.input)
    this.pitch.output.connect(this.brakeDelay).connect(this.brakeGain)

    // Rewind: the same trick pushed further. The delay grows faster than time passes, so the
    // music plays backwards (growth rate 4 = 3× speed in reverse); letting go cuts back to live.
    this.rewindDelay = ctx.createDelay(REWIND_MAX + 1)
    this.rewindDelay.delayTime.value = 0
    this.rewindGain = gain()
    this.brakeGain.connect(this.rewindDelay).connect(this.rewindGain)

    // Stutter: a delay line always holds the last moment of music. Pressed, its input closes
    // and its output feeds back into itself, so that slice loops until let go (the music runs
    // on underneath, so it comes back live).
    this.stDry = gain(1)
    this.stCap = gain(1)
    this.stDelay = ctx.createDelay(2)
    this.stFb = gain(0)
    this.stWet = gain(0)
    this.rewindGain.connect(this.stDry).connect(head)
    this.rewindGain.connect(this.stCap).connect(this.stDelay).connect(this.stWet).connect(head)
    this.stDelay.connect(this.stFb).connect(this.stDelay)

    // Music sum: the stream plus the echo returns.
    const music = gain()
    head.connect(music)

    // Ping-pong echo: left repeats feed the right line and vice versa, darker and thinner each time.
    this.echoSend = gain(0)
    head.connect(this.echoSend)
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
      this.echoFb.push(fb)
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
    // XY pad: DJ filter (low-pass one way, high-pass the other), wide open when idle.
    this.djLp = biquad(ctx, 'lowpass', 20000)
    this.djHp = biquad(ctx, 'highpass', 10)
    // Build-up: a high-pass that climbs while held, taking the bass away until the drop.
    this.buildHp = biquad(ctx, 'highpass', 10)
    this.eq[2]!.connect(this.djLp).connect(this.djHp).connect(this.buildHp)

    // Colour: dry/wet crossfade; the wet path is mono-ish → filters → drive (+ crackle and hiss).
    this.duck = gain()
    this.dry = gain(1)
    this.wet = gain(0)
    this.buildHp.connect(this.dry).connect(this.duck)
    this.colorIn = gain()
    this.buildHp.connect(this.colorIn)
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
    const pre = (this.preOut = gain(0.5))
    const limiter = ctx.createWaveShaper()
    limiter.curve = softLimitCurve()
    this.syncMute = gain()
    this.out.connect(this.syncMute).connect(pre).connect(limiter).connect(ctx.destination)
    this.master = limiter

    // Kick meter for the light show: the bass of what this device plays.
    this.kickMeter = ctx.createAnalyser()
    this.kickMeter.fftSize = this.kickBuf.length
    this.out.connect(biquad(ctx, 'lowpass', 150)).connect(this.kickMeter)

    // Instant side (low-latency context): pads and voice, added on top of the music.
    const fxOut = gain(1, fx)
    this.padGain = gain(0.8, fx)
    this.padGain.connect(fxOut)
    const fxLimiter = fx.createWaveShaper()
    fxLimiter.curve = softLimitCurve()
    fxOut.connect(gain(0.5, fx)).connect(fxLimiter).connect(fx.destination)

    this.talk = new VoiceChannel(fx, fxOut)
  }

  resume() {
    return Promise.all([this.ctx.resume(), this.fx.resume()])
  }

  /**
   * Keep the page playing with the screen off, and the lock-screen controls up. Android only keeps
   * a tab alive while the browser shows a media notification, and it only does that for a media
   * element that decodes a real source (never a `srcObject` stream), lasts 3 s or more and is
   * audible. So this loops a generated noise clip through an element; audibility is judged on
   * the decoded audio, and its output goes into a 0 gain, so nobody hears it. Call `true` from a tap.
   */
  keepAlive(on: boolean) {
    if (!on) return this.keepAliveEl?.pause()
    if (!this.keepAliveEl) {
      const el = (this.keepAliveEl = new Audio(URL.createObjectURL(noiseWav(10))))
      el.loop = true
      this.ctx.createMediaElementSource(el).connect(gainNode(this.ctx, 0)).connect(this.ctx.destination)
    }
    void this.keepAliveEl.play().catch(() => {})
  }

  /** Seconds between this page's audio and the speaker (for sync). */
  outputLatency() {
    const c = this.ctx as AudioContext & { outputLatency?: number }
    return (c.outputLatency || 0) + (c.baseLatency || 0)
  }

  /**
   * Auto-sync (app/utils/booth/autoSync.ts): goes quiet for a few seconds, listens to the
   * room with the mic, and returns how many seconds to add to this device's "ahead".
   */
  measureRoom() {
    return measureRoom(this.ctx, {
      tap: this.head,
      inject: this.preOut,
      mute: (on) => this.glide(this.syncMute.gain, on ? 0 : 1, 0.02),
      outputLatency: () => this.outputLatency(),
    })
  }

  close() {
    if (this.keepAliveEl) {
      this.keepAliveEl.pause()
      URL.revokeObjectURL(this.keepAliveEl.src)
      this.keepAliveEl = null
    }
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

  private updateEcho() {
    this.glide(this.echoSend.gain, Math.max(this.echoHeld ? 1 : 0, this.xyEcho), 0.015)
  }

  /** Pitch ▲ / ▼ held (+1 / -1): the music bends that way; 0 glides it back (see MusicPitch). */
  setPitchBend(dir: number) {
    this.pitch.bend(Math.sign(dir) as -1 | 0 | 1)
  }

  // --------------------------------------------------------- XY and brake

  /** XY pad: x sweeps a low-pass (left) or high-pass (right); y adds resonance and echo. null = let go. */
  setXY(xy: XY | null) {
    let lp = 20000
    let hp = 10
    let lpQ = Math.SQRT1_2
    let hpQ = Math.SQRT1_2
    this.xyEcho = 0
    let fb = ECHO_FEEDBACK
    if (xy) {
      const q = Math.SQRT1_2 + xy.y * 8
      if (xy.x < 0.45) {
        lp = 150 * Math.pow(20000 / 150, xy.x / 0.45)
        lpQ = q
      } else if (xy.x > 0.55) {
        hp = 20 * Math.pow(6000 / 20, (xy.x - 0.55) / 0.45)
        hpQ = q
      }
      this.xyEcho = xy.y * 0.8
      fb = ECHO_FEEDBACK + xy.y * 0.2
    }
    const tc = xy ? 0.015 : 0.05
    this.glide(this.djLp.frequency, lp, tc)
    this.glide(this.djHp.frequency, hp, tc)
    this.glide(this.djLp.Q, lpQ, tc)
    this.glide(this.djHp.Q, hpQ, tc)
    for (const g of this.echoFb) this.glide(g.gain, fb, tc)
    this.updateEcho()
  }

  /** Tape stop while held; on release it spins back up and is live (in sync) again. */
  /** Where the brake automation started, to know its values at any time (see brakeAt). */
  private brakeSeg = { on: false, t0: 0, d0: 0, g0: 1 }

  /** Brake delay and gain at time t, from the running segment (computed, not read back:
   *  reading AudioParam.value mid-automation isn't reliable across browsers). */
  private brakeAt(t: number) {
    const { on, t0, d0, g0 } = this.brakeSeg
    const s = Math.max(0, t - t0)
    if (on) {
      const k = Math.min(s, BRAKE_SEC)
      const fadeAt = BRAKE_SEC * 0.7
      return { d: d0 + (k * k) / (2 * BRAKE_SEC), g: s < fadeAt ? g0 : g0 * Math.exp(-(s - fadeAt) / 0.08) }
    }
    return { d: d0 * (1 - Math.min(1, s / SPINUP_SEC)), g: g0 + (1 - g0) * Math.min(1, s / 0.06) }
  }

  setBrake(on: boolean) {
    if (on === this.brakeSeg.on) return
    const t = this.ctx.currentTime
    const now = this.brakeAt(t)
    this.brakeSeg = { on, t0: t, d0: now.d, g0: now.g }
    const d = this.brakeDelay.delayTime
    const g = this.brakeGain.gain
    // Restart both from their computed current values.
    d.cancelScheduledValues(0)
    g.cancelScheduledValues(0)
    g.setValueAtTime(now.g, t)
    if (on) {
      // delay = s²/2D: its growth rate climbs from 0 to 1, so the speed (1 − rate) falls from 1 to 0.
      // Built from short linear ramps, not setValueCurveAtTime: Firefox can't cancel a curve
      // that has started, so letting go early threw and left the music faded and late.
      d.setValueAtTime(now.d, t)
      const n = 40
      for (let i = 1; i <= n; i++) {
        const s = (i / n) * BRAKE_SEC
        d.linearRampToValueAtTime(now.d + (s * s) / (2 * BRAKE_SEC), t + s)
      }
      g.setTargetAtTime(0, t + BRAKE_SEC * 0.7, 0.08)
    } else {
      d.setValueAtTime(now.d, t)
      d.linearRampToValueAtTime(0, t + SPINUP_SEC)
      g.linearRampToValueAtTime(1, t + 0.06)
    }
  }

  // ------------------------------------------------------------ rewind

  /** Running rewind: when it started and when it runs out (its gain then fades, see the release). */
  private rewindSeg = { on: false, t0: 0, fadeAt: Infinity }

  /** Held: spins backwards, faster and faster. Let go: cuts straight back to live. */
  setRewind(on: boolean) {
    if (on === this.rewindSeg.on) return
    const t = this.ctx.currentTime
    const d = this.rewindDelay.delayTime
    const g = this.rewindGain.gain
    d.cancelScheduledValues(0)
    g.cancelScheduledValues(0)
    if (on) {
      // The delay starts at 0 (a release always cuts back to it), its growth climbs to REWIND_RATE.
      d.setValueAtTime(0, t)
      const a = REWIND_ACCEL_SEC
      const n = 20
      for (let i = 1; i <= n; i++) {
        const s = (i / n) * a
        d.linearRampToValueAtTime((REWIND_RATE * s * s) / (2 * a), t + s)
      }
      const dA = (REWIND_RATE * a) / 2
      const tEnd = a + (REWIND_MAX - dA) / REWIND_RATE
      d.linearRampToValueAtTime(REWIND_MAX, t + tEnd)
      this.rewindSeg = { on, t0: t, fadeAt: t + tEnd - 0.3 }
      g.setValueAtTime(1, t)
      g.setTargetAtTime(0, this.rewindSeg.fadeAt, 0.1) // ran out of music to rewind
    } else {
      // Cut: a quick fade out, the delay back to 0 in the silence, a quick fade in.
      const { fadeAt } = this.rewindSeg
      this.rewindSeg = { on, t0: t, fadeAt: Infinity }
      g.setValueAtTime(t < fadeAt ? 1 : Math.exp(-(t - fadeAt) / 0.1), t)
      g.linearRampToValueAtTime(0, t + 0.03)
      d.setValueAtTime(0, t + 0.035)
      g.linearRampToValueAtTime(0, t + 0.04)
      g.linearRampToValueAtTime(1, t + 0.08)
    }
  }

  // ----------------------------------------------------------- stutter

  private stutterLen: number | null = null

  /** Held: loops the last `beats` of music (null: back to live). */
  setStutter(beats: number | null, bpm: number) {
    const len = beats ? Math.max(0.03, Math.min(1.9, (beats * 60) / bpm)) : null
    if (len === this.stutterLen) return
    const t = this.ctx.currentTime
    const engaged = this.stutterLen != null
    this.stutterLen = len
    if (len != null) {
      this.stDelay.delayTime.setValueAtTime(len, t)
      if (engaged) return // a new length while held: the loop shrinks or grows from here
      this.glide(this.stCap.gain, 0, 0.002)
      this.glide(this.stFb.gain, 1, 0.002)
      this.glide(this.stWet.gain, 1, 0.002)
      this.glide(this.stDry.gain, 0, 0.002)
    } else {
      this.glide(this.stCap.gain, 1, 0.002)
      this.glide(this.stFb.gain, 0, 0.002)
      this.glide(this.stWet.gain, 0, 0.002)
      this.glide(this.stDry.gain, 1, 0.002)
    }
  }

  // ---------------------------------------------------------- build-up

  private build: { t0: number; nodes: AudioScheduledSourceNode[]; riser: GainNode } | null = null
  private sounds: { snare: AudioBuffer; drop: AudioBuffer; noise: AudioBuffer } | null = null

  /**
   * Held: over four bars the bass is filtered away, a noise riser climbs and a snare roll
   * speeds up (quarters, eighths, sixteenths, thirty-seconds). Let go: the drop, everything
   * back at once with a sub hit and a crash.
   */
  setBuild(on: boolean, bpm: number) {
    if (on === !!this.build) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const f = this.buildHp.frequency
    const q = this.buildHp.Q
    f.cancelScheduledValues(0)
    q.cancelScheduledValues(0)
    if (on) {
      const s = (this.sounds ??= buildSounds(ctx))
      const beat = 60 / bpm
      const total = BUILD_BEATS * beat
      f.setValueAtTime(10, t)
      f.exponentialRampToValueAtTime(1400, t + total)
      q.setValueAtTime(Math.SQRT1_2, t)
      q.linearRampToValueAtTime(3, t + total)

      const riser = gainNode(ctx, 0.0001)
      const bp = biquad(ctx, 'bandpass', 300, 1.2)
      const noise = ctx.createBufferSource()
      noise.buffer = s.noise
      noise.loop = true
      noise.connect(bp).connect(riser).connect(this.out)
      bp.frequency.setValueAtTime(300, t)
      bp.frequency.exponentialRampToValueAtTime(9000, t + total)
      riser.gain.setValueAtTime(0.0001, t)
      riser.gain.exponentialRampToValueAtTime(0.35, t + total)
      noise.start(t)

      const nodes: AudioScheduledSourceNode[] = [noise]
      const roll: [number, number][] = [[8, 1], [4, 1 / 2], [2, 1 / 4], [2, 1 / 8], [16, 1 / 8]] // beats, step
      let b = 0
      for (const [len, step] of roll) {
        for (let x = 0; x < len - 1e-9; x += step, b += step) {
          const hit = ctx.createBufferSource()
          hit.buffer = s.snare
          const g = gainNode(ctx, 0.2 + 0.6 * Math.min(1, b / BUILD_BEATS))
          hit.connect(g).connect(this.out)
          hit.start(t + b * beat)
          nodes.push(hit)
        }
      }
      this.build = { t0: t, nodes, riser }
    } else {
      const b = this.build!
      this.build = null
      for (const n of b.nodes) {
        try {
          n.stop(t + 0.05)
        } catch {
          /* already stopped */
        }
      }
      b.riser.gain.cancelScheduledValues(0)
      b.riser.gain.setTargetAtTime(0, t, 0.02)
      f.setValueAtTime(10, t)
      q.setValueAtTime(Math.SQRT1_2, t)
      if (t - b.t0 > 1.5) {
        const drop = ctx.createBufferSource()
        drop.buffer = this.sounds!.drop
        drop.connect(gainNode(ctx, 0.9)).connect(this.out)
        drop.start(t)
      }
    }
  }

  // ------------------------------------------------------- light show

  /** Bass level of what this device plays right now (RMS), for the light show. */
  kickLevel() {
    this.kickMeter.getFloatTimeDomainData(this.kickBuf)
    let s = 0
    for (const x of this.kickBuf) s += x * x
    return Math.sqrt(s / this.kickBuf.length)
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

  /** Talkover voice character (this device only). */
  setVoicePreset(p: VoicePreset) {
    this.talk.setPreset(p)
  }

  setVoiceVolume(v: number) {
    this.talk.setVolume(v)
  }

  /**
   * Talkover held on this device: open the mic into the mix (asks for the microphone the
   * first time; it then stays open until listening stops). Throws if the mic is unavailable.
   */
  voice(on: boolean) {
    return this.talk.hold(on)
  }

  closeMic() {
    this.talk.closeMic()
  }
}

/** The build-up's sounds, synthesised once: a snare hit, the drop (sub hit + crash) and noise. */
function buildSounds(ctx: BaseAudioContext) {
  const sr = ctx.sampleRate
  const make = (sec: number, fill: (t: number, noise: number) => [number, number]) => {
    const n = Math.floor(sec * sr)
    const buf = ctx.createBuffer(2, n, sr)
    const L = buf.getChannelData(0)
    const R = buf.getChannelData(1)
    let last = 0
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1
      const bright = w - last // first difference: brighter noise
      last = w
      ;[L[i], R[i]] = fill(i / sr, bright)
    }
    return buf
  }
  let phase = 0
  return {
    snare: make(0.22, (t, nz) => {
      const body = Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 40) * 0.5
      const v = nz * Math.exp(-t * 18) * 0.45 + body
      return [v, v]
    }),
    drop: make(2.2, (t, nz) => {
      phase += (2 * Math.PI * (36 + 70 * Math.exp(-t * 7))) / sr
      const sub = Math.sin(phase) * Math.exp(-t * 1.6) * 0.9
      const crash = nz * Math.exp(-t * 2.4) * 0.22
      return [sub + crash, sub + crash * 0.9]
    }),
    noise: make(2, (_t, nz) => [nz * 0.5, nz * 0.5]),
  }
}

/** `sec` seconds of white noise as a WAV file (8 kHz mono 16-bit), for the keep-alive element. */
function noiseWav(sec: number) {
  const sr = 8000
  const n = sr * sec
  const v = new DataView(new ArrayBuffer(44 + n * 2))
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, (Math.random() * 2 - 1) * 3000, true)
  return new Blob([v.buffer], { type: 'audio/wav' })
}
