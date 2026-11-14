import { describe, expect, it } from 'vitest'
import { LIVE_JUMP, LIVE_MAX_RATE, LivePlayerCore, STREAM_SR, UNSYNCED_LEAD } from '../app/utils/livePlayerCore'

const BLOCK = 4800
const Q = 128 // render quantum

/** A block whose samples count up from its first stream sample (value = sample number). */
const block = (s: number, len = BLOCK) => {
  const l = Float32Array.from({ length: len }, (_, i) => s + i)
  return { l, r: l.slice(), s }
}
/** Renders n quanta from context time t (rate sr), returns the left channel. */
function render(core: LivePlayerCore, t: number, n: number, sr = STREAM_SR) {
  const out: number[] = []
  for (let q = 0; q < n; q++) {
    const L = new Float32Array(Q)
    const R = new Float32Array(Q)
    core.render(L, R, t + (q * Q) / sr, sr)
    out.push(...L)
  }
  return out
}

describe('LivePlayerCore', () => {
  it('waits for UNSYNCED_LEAD of audio when unsynced, then plays it back to back', () => {
    const core = new LivePlayerCore()
    core.push(block(1000))
    expect(render(core, 0, 1).every((x) => x === 0)).toBe(true) // 0.1 s < 0.3 s: waiting
    for (let i = 1; i < (UNSYNCED_LEAD * STREAM_SR) / BLOCK; i++) core.push(block(1000 + i * BLOCK))
    const out = render(core, 0, 80) // across block borders
    out.forEach((x, k) => expect(x).toBe(1000 + k))
  })

  it('plays sample s at the mapped time, seamlessly across blocks', () => {
    const core = new LivePlayerCore()
    for (let i = 0; i < 4; i++) core.push(block(i * BLOCK))
    core.setMap(1000, 2) // sample 1000 at t = 2 s
    const out = render(core, 2, 60)
    out.forEach((x, k) => expect(x).toBe(1000 + k))
    expect(core.takeStats().err).toBe(0)
  })

  it('steers a small error with a capped speed change, without a jump', () => {
    const core = new LivePlayerCore()
    for (let i = 0; i < 4; i++) core.push(block(i * BLOCK))
    core.setMap(1000, 2)
    render(core, 2, 1)
    core.setMap(1000 + 0.02 * STREAM_SR, 2) // the others are now 20 ms ahead: this device is late
    const out = render(core, 2 + Q / STREAM_SR, 1)
    const step = out[1]! - out[0]!
    expect(step).toBeCloseTo(1 + LIVE_MAX_RATE, 4) // 0.02 × 0.25 is capped (Float32 samples)
    expect(core.takeStats().jumps).toBe(0)
  })

  it('jumps when off by more than LIVE_JUMP', () => {
    const core = new LivePlayerCore()
    for (let i = 0; i < 4; i++) core.push(block(i * BLOCK))
    core.setMap(1000, 2)
    render(core, 2, 1)
    const off = Math.round((LIVE_JUMP + 0.01) * STREAM_SR)
    core.setMap(1000 + off, 2)
    const out = render(core, 2 + Q / STREAM_SR, 1)
    expect(out[0]).toBe(1000 + off + Q)
    expect(core.takeStats().jumps).toBe(1)
  })

  it('drops a block that arrives already over, and plays silence for a missing one', () => {
    const core = new LivePlayerCore()
    core.push(block(0))
    core.setMap(0, 0)
    render(core, 0, 40) // now past sample 5120
    core.takeStats()
    core.push(block(BLOCK * 2)) // block 1 never came
    core.push(block(0)) // a late copy of block 0
    const s = core.takeStats()
    expect([s.late, s.played]).toEqual([1, 1])
    const gap = render(core, (40 * Q) / STREAM_SR, 30) // samples 5120–8960: in the missing block
    expect(gap.every((x) => x === 0)).toBe(true)
    expect(core.takeStats().starved).toBe(30 * Q)
  })

  it("doesn't count the start-up backlog as late, nor the silence before the first sound", () => {
    const core = new LivePlayerCore()
    core.setMap(10 * BLOCK, 0) // synced before any audio came
    render(core, 0, 10)
    for (let i = 0; i < 12; i++) core.push(block(i * BLOCK)) // the past seconds, all over
    const s = core.takeStats()
    expect([s.late, s.starved, s.leads.length]).toEqual([0, 0, 0])
  })

  it('resamples the 48 kHz stream to a 44.1 kHz context continuously', () => {
    const core = new LivePlayerCore()
    for (let i = 0; i < 3; i++) core.push(block(i * BLOCK))
    core.setMap(0, 0)
    const out = render(core, 0, 60, 44100)
    out.forEach((x, k) => expect(x).toBeCloseTo((k * 48000) / 44100, 3))
  })
})
