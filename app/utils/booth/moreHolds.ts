/**
 * Five more holds on the music (app/utils/boothAudio.ts), between the rewind and the stutter:
 *
 *   in ─▶ slow-mo delay ─▶ scratch delay ─┬─────────────────────┬─▶ gate ─▶ out
 *                                         └─ flanger (feedback) ┘
 *   air horn ─▶ hornOut (after the duck, like the build-up's sounds)
 *
 *  - Slow-mo: the delay grows at up to 0.3 s per second, so the music runs at 70 % speed (and
 *    pitch); let go, it speeds back up in 1 s, then cuts back to live.
 *  - Scratch: the record is pushed back and forth around the moment pressed, once per beat.
 *  - Gater: the volume chopped on 1/16 notes in tempo.
 *  - Flanger: a jet sweep that gets deeper the longer it's held.
 *  - Air horn: "bwa-bwa-bwa-bwaaa" each bar, synthesised.
 */
import { biquad, driveCurve, gainNode } from './dsp'

const SLOW_RATE = 0.3 // delay growth at full slow-mo: 70 % speed
const SLOW_IN = 1.5 // s to get there
const SLOW_OUT = 1 // s to get back to full speed, then the cut to live
const SCRATCH_SEC = 0.22 // how far back the record is pulled each stroke
/** Delay lines' length (memory: ~8 MB each in stereo): slow-mo for ~1 min, scratch for 20 s. */
const MAX_DELAY = 20

/** One hold's delay line: its value and growth rate at any time, computed (not read back). */
interface Seg {
  t0: number
  d0: number
  r0: number
  rTarget: number
  slope: number // rate change per second
}

function segAt(s: Seg, t: number) {
  const u = Math.max(0, t - s.t0)
  const ramp = Math.abs(s.rTarget - s.r0) / s.slope // time to reach the target rate
  const k = Math.min(u, ramp)
  const dir = Math.sign(s.rTarget - s.r0)
  const r = s.r0 + dir * s.slope * k
  const d = s.d0 + s.r0 * k + (dir * s.slope * k * k) / 2 + s.rTarget * Math.max(0, u - ramp)
  return { d: Math.min(MAX_DELAY, Math.max(0, d)), r }
}

export class MoreHolds {
  readonly input: GainNode
  readonly output: GainNode
  private slowDelay: DelayNode
  private slowGain: GainNode
  private slow: (Seg & { on: boolean }) | null = null
  private slowCut: ReturnType<typeof setTimeout> | undefined
  private scratchDelay: DelayNode
  private scratchGain: GainNode
  private scratching = false
  private flDelay: DelayNode
  private flWet: GainNode
  private flFb: GainNode
  private flLfo: OscillatorNode | null = null
  private gate: GainNode
  private gateMod: GainNode
  private gateOsc: OscillatorNode | null = null
  private horn: { nodes: AudioScheduledSourceNode[]; out: GainNode } | null = null

  constructor(private ctx: AudioContext, private hornOut: AudioNode) {
    this.input = gainNode(ctx)
    this.output = gainNode(ctx)
    this.slowDelay = ctx.createDelay(MAX_DELAY + 1)
    this.slowDelay.delayTime.value = 0
    this.slowGain = gainNode(ctx)
    this.scratchDelay = ctx.createDelay(MAX_DELAY + 1)
    this.scratchDelay.delayTime.value = 0
    this.scratchGain = gainNode(ctx)
    this.input.connect(this.slowDelay).connect(this.slowGain).connect(this.scratchDelay).connect(this.scratchGain)

    // Flanger: a short delay swept by an LFO, fed back into itself, added to the dry music.
    this.flDelay = ctx.createDelay(0.02)
    this.flDelay.delayTime.value = 0.003
    this.flWet = gainNode(ctx, 0)
    this.flFb = gainNode(ctx, 0)
    this.gate = gainNode(ctx)
    this.gateMod = gainNode(ctx, 0)
    this.gateMod.connect(this.gate.gain)
    this.scratchGain.connect(this.gate)
    this.scratchGain.connect(this.flDelay).connect(this.flWet).connect(this.gate)
    this.flDelay.connect(this.flFb).connect(this.flDelay)
    this.gate.connect(this.output)
  }

  private glide(p: AudioParam, v: number, tc: number, at = this.ctx.currentTime) {
    p.cancelScheduledValues(at)
    p.setTargetAtTime(v, at, tc)
  }

  /** Schedules the delay along a segment, from now (short linear ramps, cancellable everywhere). */
  private runDelay(p: AudioParam, seg: Seg, until: number) {
    const t = this.ctx.currentTime
    p.cancelScheduledValues(0)
    p.setValueAtTime(segAt(seg, t).d, t)
    // Fine steps while the speed changes, then one straight line (constant speed).
    const ramp = Math.min(until, seg.t0 + Math.abs(seg.rTarget - seg.r0) / seg.slope)
    for (let at = t + 0.05; at < ramp; at += 0.05) p.linearRampToValueAtTime(segAt(seg, at).d, at)
    p.linearRampToValueAtTime(segAt(seg, ramp).d, ramp)
    if (until > ramp) p.linearRampToValueAtTime(segAt(seg, until).d, until)
  }

  /** Cut a delay line back to live: a quick fade out, the delay to 0 in the silence, fade in. */
  private cutToLive(d: DelayNode, g: GainNode, at: number) {
    const p = g.gain
    p.cancelScheduledValues(at)
    p.setValueAtTime(1, at)
    p.linearRampToValueAtTime(0, at + 0.03)
    d.delayTime.cancelScheduledValues(at + 0.035)
    d.delayTime.setValueAtTime(0, at + 0.035)
    p.linearRampToValueAtTime(0, at + 0.04)
    p.linearRampToValueAtTime(1, at + 0.08)
  }

  // ----------------------------------------------------------- slow-mo

  setSlowmo(on: boolean) {
    if (on === !!this.slow?.on) return
    const t = this.ctx.currentTime
    const now = this.slow ? segAt(this.slow, t) : { d: 0, r: 0 }
    clearTimeout(this.slowCut)
    this.slowGain.gain.cancelScheduledValues(0)
    this.slowGain.gain.setValueAtTime(1, t)
    if (on) {
      this.slow = { on, t0: t, d0: now.d, r0: now.r, rTarget: SLOW_RATE, slope: SLOW_RATE / SLOW_IN }
      this.runDelay(this.slowDelay.delayTime, this.slow, t + MAX_DELAY / SLOW_RATE)
    } else {
      this.slow = { on, t0: t, d0: now.d, r0: now.r, rTarget: 0, slope: SLOW_RATE / SLOW_OUT }
      const back = (now.r / SLOW_RATE) * SLOW_OUT
      this.runDelay(this.slowDelay.delayTime, this.slow, t + back)
      this.cutToLive(this.slowDelay, this.slowGain, t + back)
      this.slowCut = setTimeout(() => {
        if (!this.slow?.on) this.slow = null
      }, (back + 0.1) * 1000)
    }
  }

  // ----------------------------------------------------------- scratch

  /** Held: the record goes back and forth around the moment pressed, one stroke per beat. */
  setScratch(on: boolean, bpm: number) {
    if (on === this.scratching) return
    this.scratching = on
    const t = this.ctx.currentTime
    const p = this.scratchDelay.delayTime
    p.cancelScheduledValues(0)
    if (on) {
      // The record is pulled x(s) = A(1 − cos 2πfs)/2 behind the press point and pushed back to it,
      // while the live music runs on: delay = s + x(s).
      const f = bpm / 60
      const steps = 24 // per stroke
      const total = MAX_DELAY - 1 // s scheduled ahead (held longer, it just plays on from there)
      p.setValueAtTime(0, t)
      for (let i = 1; i <= total * f * steps; i++) {
        const s = i / (f * steps)
        const x = (SCRATCH_SEC * (1 - Math.cos(2 * Math.PI * f * s))) / 2
        p.linearRampToValueAtTime(s + x, t + s)
      }
    } else {
      this.cutToLive(this.scratchDelay, this.scratchGain, t)
    }
  }

  // ------------------------------------------------------------- gater

  /** Held: the volume chopped on 1/16 notes (a square LFO, softened so it doesn't click). */
  setGate(on: boolean, bpm: number) {
    if (on === !!this.gateOsc) return
    const t = this.ctx.currentTime
    if (on) {
      const osc = (this.gateOsc = this.ctx.createOscillator())
      osc.type = 'square'
      osc.frequency.value = (bpm / 60) * 4
      osc.connect(biquad(this.ctx, 'lowpass', 120)).connect(this.gateMod)
      osc.start(t)
      // gain = 0.5 + 0.5·square: 1 then 0, each half of a sixteenth.
      this.glide(this.gate.gain, 0.5, 0.005)
      this.glide(this.gateMod.gain, 0.5, 0.005)
    } else {
      const osc = this.gateOsc!
      this.gateOsc = null
      this.glide(this.gate.gain, 1, 0.01)
      this.glide(this.gateMod.gain, 0, 0.01)
      osc.stop(t + 0.1)
    }
  }

  // ----------------------------------------------------------- flanger

  /** Held: a jet sweep, deeper and deeper over 4 s; let go, it fades out. */
  setFlanger(on: boolean) {
    const t = this.ctx.currentTime
    if (on && !this.flLfo) {
      const lfo = (this.flLfo = this.ctx.createOscillator())
      lfo.frequency.value = 0.25
      lfo.connect(gainNode(this.ctx, 0.0025)).connect(this.flDelay.delayTime) // 0.5–5.5 ms
      lfo.start(t)
    }
    for (const [p, v] of [[this.flWet.gain, 0.8], [this.flFb.gain, 0.7]] as const) {
      p.cancelScheduledValues(0)
      p.setValueAtTime(p.value, t)
      if (on) p.linearRampToValueAtTime(v, t + 4)
      else p.setTargetAtTime(0, t, 0.15)
    }
  }

  // ----------------------------------------------------------- air horn

  /** Held: an air horn, "bwa-bwa-bwa-bwaaa" each bar, until let go. */
  setHorn(on: boolean, bpm: number) {
    if (on === !!this.horn) return
    const ctx = this.ctx
    const t = ctx.currentTime
    if (on) {
      const out = gainNode(ctx, 0)
      const shape = ctx.createWaveShaper()
      shape.curve = driveCurve(3)
      const tone = biquad(ctx, 'peaking', 1800, 1, 6)
      out.connect(shape).connect(tone).connect(biquad(ctx, 'highpass', 200)).connect(gainNode(ctx, 0.25)).connect(this.hornOut)
      const pitches = [466, 470, 587, 932]
      const nodes = pitches.map((hz) => {
        const o = ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = hz
        o.connect(out)
        o.start(t)
        return o
      })
      // One bar: three short blasts on the eighths, then a long one.
      const beat = 60 / bpm
      const blasts: [number, number][] = [[0, 0.35], [0.5, 0.35], [1, 0.35], [1.5, 2.2]]
      const g = out.gain
      g.setValueAtTime(0, t)
      for (let bar = 0; bar < 16; bar++) {
        for (const [at, len] of blasts) {
          const s = t + (bar * 4 + at) * beat
          g.setValueAtTime(0, s)
          g.linearRampToValueAtTime(1, s + 0.01)
          g.setValueAtTime(1, s + len * beat - 0.03)
          g.linearRampToValueAtTime(0, s + len * beat)
        }
      }
      // The long blast sags a little in pitch, like a can running low.
      nodes.forEach((o, i) => {
        const hz = pitches[i]!
        for (let bar = 0; bar < 16; bar++) {
          const s = t + (bar * 4 + 1.5) * beat
          o.frequency.setValueAtTime(hz, s)
          o.frequency.linearRampToValueAtTime(hz * 0.97, s + 2.2 * beat)
          o.frequency.setValueAtTime(hz, s + 2.5 * beat)
        }
      })
      this.horn = { nodes, out }
    } else {
      const h = this.horn!
      this.horn = null
      h.out.gain.cancelScheduledValues(0)
      h.out.gain.setTargetAtTime(0, t, 0.02)
      for (const n of h.nodes) n.stop(t + 0.15)
    }
  }
}
