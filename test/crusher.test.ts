import { describe, expect, it } from 'vitest'
import { CrusherCore } from '../app/utils/booth/crusher'

describe('CrusherCore', () => {
  it('holds each value for `hold` samples, rounded to `bits`', () => {
    const c = new CrusherCore(3, 2) // 4 steps per side: multiples of 0.25
    const x = Float32Array.from([0.1, 0.9, 0.3, 0.3, -0.6, 0])
    const y = new Float32Array(6)
    c.process(0, x, y)
    expect([...y]).toEqual([0, 0, 0.25, 0.25, -0.5, -0.5])
  })

  it('keeps holding across blocks, per channel', () => {
    const c = new CrusherCore(8, 3)
    const y = new Float32Array(2)
    c.process(0, Float32Array.from([0.5, 0]), y)
    c.process(1, Float32Array.from([-1, -1]), new Float32Array(2))
    c.process(0, Float32Array.from([0, 0]), y)
    expect(y[0]).toBe(0.5) // the third sample of the hold
    expect(y[1]).toBe(0)
  })
})
