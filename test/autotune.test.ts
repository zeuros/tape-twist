import { describe, expect, it } from 'vitest'
import { AutoTuneCore } from '../app/utils/booth/autotune'

const SR = 48000

/** A voice-like tone (fundamental + harmonics) at f Hz, `sec` long. */
function tone(f: number, sec: number) {
  return Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => {
    const t = (2 * Math.PI * f * i) / SR
    return 0.3 * Math.sin(t) + 0.15 * Math.sin(2 * t) + 0.08 * Math.sin(3 * t)
  })
}
/** The pitch of the last part of `x`, by the (tested) detector of a fresh core. */
function freq(x: Float32Array, sec: number) {
  const probe = new AutoTuneCore(SR)
  const tail = x.slice(x.length - Math.round(sec * SR))
  for (let i = 0; i < tail.length; i += 128) probe.process(tail.subarray(i, i + 128))
  return probe.pitch
}
function run(f: number, sec = 1) {
  const core = new AutoTuneCore(SR)
  const x = tone(f, sec)
  for (let i = 0; i < x.length; i += 128) core.process(x.subarray(i, i + 128))
  return { core, x }
}

describe('AutoTuneCore', () => {
  it('finds the pitch of a voiced tone', () => {
    const { core } = run(196)
    expect(core.pitch).toBeGreaterThan(194)
    expect(core.pitch).toBeLessThan(198)
  })

  it('snaps a tone between two notes to the nearest one', () => {
    // 452 Hz is +47 cents over A4 (440): it comes out at 440.
    const { x } = run(452)
    expect(Math.abs(freq(x, 0.4) - 440)).toBeLessThan(3)
  })

  it('snaps a low tone upward too', () => {
    // 108 Hz is −32 cents under A2 (110).
    const { x } = run(108)
    expect(Math.abs(freq(x, 0.4) - 110)).toBeLessThan(1.5)
  })

  it('leaves silence alone', () => {
    const core = new AutoTuneCore(SR)
    const x = new Float32Array(SR / 2)
    core.process(x)
    expect(core.pitch).toBe(0)
    expect(x.every((v) => v === 0)).toBe(true)
  })
})
