import { describe, expect, it } from 'vitest'
import { VOICE_FRAME, VOICE_HEADER, VOICE_MAX, VOICE_SR, VOICE_START, VOICE_STEP, VoiceFramer, VoiceMixCore } from '../app/utils/voiceJitter'

/** A relayed frame from talker `slot`, every sample = v. */
function frame(slot: number, seq: number, v = 0.5) {
  const buf = new ArrayBuffer(VOICE_HEADER + VOICE_FRAME * 2)
  const d = new DataView(buf)
  d.setUint8(0, slot)
  d.setUint16(2, seq, true)
  new Int16Array(buf, VOICE_HEADER).fill(Math.round(v * 32768))
  return buf
}
const render = (core: VoiceMixCore, n: number, sr = 48000) => {
  const out = new Float32Array(n)
  core.render(out, sr)
  return out
}
const START_FRAMES = Math.ceil((VOICE_START * VOICE_SR) / VOICE_FRAME)

describe('VoiceFramer', () => {
  it('turns 48 kHz into numbered 20 ms frames at 16 kHz', () => {
    const got: ArrayBuffer[] = []
    const f = new VoiceFramer((b) => got.push(b))
    f.push(new Float32Array(960 * 2).fill(0.25), 48000) // 40 ms
    expect(got).toHaveLength(2)
    expect(got.map((b) => new DataView(b).getUint16(2, true))).toEqual([0, 1])
    const pcm = new Int16Array(got[0]!, VOICE_HEADER)
    expect(pcm.length).toBe(VOICE_FRAME)
    expect(pcm.every((x) => x === Math.round(0.25 * 32767))).toBe(true)
  })

  it('makes 16 kHz frames from 44.1 kHz too', () => {
    const got: ArrayBuffer[] = []
    const f = new VoiceFramer((b) => got.push(b))
    f.push(new Float32Array(44100), 44100)
    expect(got.length).toBeGreaterThanOrEqual(VOICE_SR / VOICE_FRAME - 1) // float phase: 49 or 50
  })
})

describe('VoiceMixCore', () => {
  it('waits for VOICE_START buffered before playing', () => {
    const core = new VoiceMixCore()
    for (let i = 0; i < START_FRAMES - 1; i++) core.push(frame(0, i))
    expect(render(core, 128).every((x) => x === 0)).toBe(true)
    core.push(frame(0, START_FRAMES - 1))
    expect(render(core, 128).every((x) => Math.abs(x - 0.5) < 1e-6)).toBe(true)
  })

  it('plays silence for a lost frame, then the next one', () => {
    const core = new VoiceMixCore()
    for (let i = 0; i < START_FRAMES; i++) core.push(frame(0, i))
    core.push(frame(0, START_FRAMES + 1, 0.25)) // frame START_FRAMES lost
    const out = render(core, ((START_FRAMES + 2) * VOICE_FRAME * 48000) / VOICE_SR - 3)
    const at = (f: number) => out[Math.round(((f + 0.5) * VOICE_FRAME * 48000) / VOICE_SR)]!
    expect(at(0)).toBeCloseTo(0.5, 5)
    expect(at(START_FRAMES)).toBe(0)
    expect(at(START_FRAMES + 1)).toBeCloseTo(0.25, 5)
  })

  it('waits VOICE_STEP longer after running dry (late frames)', () => {
    const core = new VoiceMixCore()
    for (let i = 0; i < START_FRAMES; i++) core.push(frame(0, i))
    render(core, (START_FRAMES * VOICE_FRAME * 48000) / VOICE_SR) // plays it all: dry
    const more = Math.ceil(((VOICE_START + VOICE_STEP) * VOICE_SR) / VOICE_FRAME)
    for (let i = 0; i < START_FRAMES; i++) core.push(frame(0, START_FRAMES + i))
    expect(render(core, 128).every((x) => x === 0)).toBe(true) // VOICE_START isn't enough now
    for (let i = START_FRAMES; i < more; i++) core.push(frame(0, START_FRAMES + i))
    expect(render(core, 128).every((x) => Math.abs(x - 0.5) < 1e-6)).toBe(true)
  })

  it('drops the oldest audio when a burst goes over VOICE_MAX', () => {
    const core = new VoiceMixCore()
    const n = Math.ceil((VOICE_MAX * VOICE_SR) / VOICE_FRAME) + 5
    for (let i = 0; i < n; i++) core.push(frame(0, i))
    // Never more than VOICE_MAX of delay: it runs dry before that much has played.
    const out = render(core, (VOICE_MAX * 48000) | 0)
    expect(out[0]).toBeCloseTo(0.5, 5)
    expect(out.at(-1)).toBe(0)
  })

  it('upsamples to 44.1 kHz', () => {
    const core = new VoiceMixCore()
    for (let i = 0; i < START_FRAMES; i++) core.push(frame(0, i))
    const out = render(core, Math.floor((START_FRAMES * VOICE_FRAME * 44100) / VOICE_SR) - 2, 44100)
    expect(out.every((x) => Math.abs(x - 0.5) < 1e-6)).toBe(true)
  })

  it('sums two talkers, and ignores a late duplicate', () => {
    const core = new VoiceMixCore()
    for (let i = 0; i < START_FRAMES; i++) {
      core.push(frame(1, i, 0.25))
      core.push(frame(2, i, 0.125))
    }
    core.push(frame(1, 0, 0.9)) // late copy: dropped
    const out = render(core, 128)
    expect(out.every((x) => Math.abs(x - 0.375) < 1e-6)).toBe(true)
  })
})
