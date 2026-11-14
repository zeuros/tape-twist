import { describe, expect, it } from 'vitest'
import { TempoTracker } from '../server/utils/tempo'

const SR = 48000

/** `sec` of a four-on-the-floor loop: kicks on every beat, hats on the off-beats, a bass hum. */
function track(bpm: number, sec: number, seed = 1) {
  const n = Math.round(sec * SR)
  const L = new Float32Array(n)
  let rnd = seed
  const noise = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647) * 2 - 1
  const beat = (60 / bpm) * SR
  for (let i = 0; i < n; i++) {
    const inBeat = i % beat
    const t = inBeat / SR
    const kick = Math.sin(2 * Math.PI * (55 + 80 * Math.exp(-t * 40)) * t) * Math.exp(-t * 9) * 0.8
    const off = (i + beat / 2) % beat
    const hat = noise() * Math.exp((-off / SR) * 60) * 0.15
    const hum = Math.sin((2 * Math.PI * 110 * i) / SR) * 0.1
    L[i] = kick + hat + hum
  }
  return L
}

function run(audio: Float32Array) {
  const t = new TempoTracker(SR)
  for (let i = 0; i < audio.length; i += 2048) {
    const c = audio.subarray(i, i + 2048)
    t.push(c, c)
  }
  return t.bpm
}

describe('TempoTracker', () => {
  for (const bpm of [95, 120, 128, 140, 150]) {
    it(`finds ${bpm} BPM`, () => {
      expect(run(track(bpm, 12))).toBeCloseTo(bpm, -0.3) // within ±1
    })
  }

  it('gives no tempo for silence or a steady tone', () => {
    expect(run(new Float32Array(SR * 12))).toBeNull()
    const tone = new Float32Array(SR * 12).map((_, i) => Math.sin((2 * Math.PI * 80 * i) / SR) * 0.5)
    expect(run(tone)).toBeNull()
  })

  it('follows a tempo change', () => {
    const a = track(100, 10)
    const b = track(130, 14, 7)
    const both = new Float32Array(a.length + b.length)
    both.set(a)
    both.set(b, a.length)
    expect(run(both)).toBeCloseTo(130, -0.3)
  })
})
