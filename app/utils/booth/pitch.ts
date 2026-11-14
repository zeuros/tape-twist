import { PITCH_MAX, PITCH_RELEASE, PITCH_SPEED } from '#shared/types/booth'
import { gainNode } from './dsp'

/** Length of each tap's sweep at full speed (s): short enough not to smear the beat. */
const WIN = 0.06
const MIN_DELAY = 0.004
const XFADE = 0.03 // dry ↔ shifted crossfade (time constant), only at exactly 0

/**
 * Pitch bend for the music that keeps its timing (every phone stays in sync): two delay
 * taps whose length sweeps at a steady rate (the rate is the speed change), each faded in
 * and out (sin², half a cycle apart, so they always sum to 1). The sweep is a looping
 * buffer source, so its playbackRate sets the shift and can follow a curve.
 *
 * Like Build-up, a hold: while ▲ or ▼ is held the pitch bends that way at PITCH_SPEED, up to
 * PITCH_MAX; let go and it glides back to 0 in PITCH_RELEASE, then the dry signal plays again
 * (no added delay). Each phone runs the curve itself from the moment the hold reaches it.
 */
export class MusicPitch {
  readonly input: GainNode
  readonly output: GainNode
  private dry: GainNode
  private wet: GainNode
  private lfo: AudioBufferSourceNode
  private depth: GainNode[] = []
  private delays: DelayNode[] = []
  private dir = 0 // the taps' sweep way while they play: +1 up, -1 down, 0 dry
  private held = 0 // the button held now: +1, -1 or 0
  private dryAt: ReturnType<typeof setTimeout> | undefined
  /** The sweep rate's schedule, [time, value] points joined by linear ramps: the value now is
   *  computed from it (AudioParam.value isn't reliable mid-automation in every browser). */
  private pts: [number, number, boolean][] = [[0, 0, false]]

  constructor(private ctx: BaseAudioContext) {
    this.input = gainNode(ctx)
    this.output = gainNode(ctx)
    this.dry = gainNode(ctx, 1)
    this.wet = gainNode(ctx, 0)
    this.input.connect(this.dry).connect(this.output)
    this.wet.connect(this.output)

    // One source for both taps, so they can't drift apart: [saw A, fade A, saw B, fade B].
    const len = Math.round(WIN * ctx.sampleRate)
    const buf = ctx.createBuffer(4, len, ctx.sampleRate)
    for (const [ch, shift] of [[0, 0], [2, 0.5]] as const) {
      const saw = buf.getChannelData(ch)
      const fade = buf.getChannelData(ch + 1)
      for (let i = 0; i < len; i++) {
        const ph = (i / len + shift) % 1
        saw[i] = ph
        fade[i] = Math.sin(Math.PI * ph) ** 2
      }
    }
    this.lfo = ctx.createBufferSource()
    this.lfo.buffer = buf
    this.lfo.loop = true
    this.lfo.playbackRate.value = 0
    const split = ctx.createChannelSplitter(4)
    this.lfo.connect(split)
    for (const ch of [0, 2]) {
      const d = ctx.createDelay(MIN_DELAY + WIN + 0.01)
      d.delayTime.value = MIN_DELAY
      const depth = gainNode(ctx, 0) // delay = base + depth · saw
      split.connect(depth, ch).connect(d.delayTime)
      const fade = gainNode(ctx, 0)
      split.connect(fade.gain, ch + 1)
      this.input.connect(d).connect(fade).connect(this.wet)
      this.delays.push(d)
      this.depth.push(depth)
    }
    this.lfo.start()
  }

  /** Rate of the sweep for a shift of `semis` semitones (magnitude) in way `dir`. */
  private static rate(semis: number, dir: number) {
    return dir > 0 ? Math.pow(2, semis / 12) - 1 : 1 - Math.pow(2, -semis / 12)
  }

  /** ▲ held (+1), ▼ held (-1), or let go (0). */
  bend(dir: -1 | 0 | 1) {
    if (dir === this.held) return
    this.held = dir
    clearTimeout(this.dryAt)
    const t = this.ctx.currentTime
    const r = this.lfo.playbackRate
    const now = this.rateAt(t)
    // Restart from the computed current value, with linear ramps only. Not setValueCurveAtTime:
    // Firefox can't add events while a curve runs ("Can't add events during a curve event"),
    // so letting go threw and the pitch kept rising (same fix as Brake in boothAudio.ts).
    r.cancelScheduledValues(0)
    this.pts = []
    this.point(now, t)
    if (dir === 0) {
      // Glide back, then back to dry once the sweep has stopped.
      this.point(0, t + PITCH_RELEASE, true)
      this.dryAt = setTimeout(() => this.toDry(), PITCH_RELEASE * 1000)
      return
    }
    // Pressed again before the glide back ended: carry on from where it is, same way.
    let from = this.dir === dir ? 12 * Math.abs(Math.log2(dir > 0 ? 1 + now : 1 - now)) : 0
    if (this.dir !== dir) {
      // Set the sweep's way (the taps are faded out for it if they were playing the other way).
      // Up: the delay shrinks (base + WIN − WIN·saw); down: it grows (base + WIN·saw).
      const at = this.dir ? t + 0.03 : t
      if (this.dir) this.wet.gain.setTargetAtTime(0, t, 0.008)
      for (const d of this.delays) d.delayTime.setValueAtTime(MIN_DELAY + (dir > 0 ? WIN : 0), at)
      for (const g of this.depth) g.gain.setValueAtTime(dir > 0 ? -WIN : WIN, at)
      this.point(now, at)
      this.point(0, at)
      from = 0
      this.dir = dir
    }
    const start = this.ctx.currentTime + 0.035
    const dur = (PITCH_MAX - from) / PITCH_SPEED
    this.point(MusicPitch.rate(from, dir), start)
    const n = 64
    for (let i = 1; i <= n && dur > 0; i++) {
      this.point(MusicPitch.rate(from + (i / n) * (PITCH_MAX - from), dir), start + (i / n) * dur, true)
    }
    this.wet.gain.setTargetAtTime(1, start - 0.005, XFADE)
    this.dry.gain.setTargetAtTime(0, start - 0.005, XFADE)
  }

  /** Adds a point to the sweep rate's schedule: a step to it at `at`, or a linear ramp to it. */
  private point(value: number, at: number, ramp = false) {
    const r = this.lfo.playbackRate
    if (ramp) r.linearRampToValueAtTime(value, at)
    else r.setValueAtTime(value, at)
    this.pts.push([at, value, ramp])
  }

  /** The sweep rate at time t, from its schedule (before a step, the value holds). */
  private rateAt(t: number) {
    const pts = this.pts
    if (t < pts[0]![0]) return pts[0]![1]
    for (let i = 1; i < pts.length; i++) {
      const [t1, v1, ramp] = pts[i]!
      if (t < t1) {
        const [t0, v0] = pts[i - 1]!
        return ramp ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v0
      }
    }
    return pts[pts.length - 1]![1]
  }

  private toDry() {
    if (this.held) return
    const t = this.ctx.currentTime
    this.wet.gain.setTargetAtTime(0, t, XFADE)
    this.dry.gain.setTargetAtTime(1, t, XFADE)
    this.dir = 0
  }
}
