import { describe, expect, it } from 'vitest'
import { createScheduler, PCM_MAX_RATE, UNSYNCED_LEAD } from '../app/utils/pcmScheduler'

const SR = 48000
const BLOCK = 4800
const DUR = BLOCK / SR

/** A fake AudioContext that records what gets started, and when. */
function fakeCtx() {
  const started: { at: number; offset?: number; rate: number; stopped: boolean }[] = []
  const ctx = {
    currentTime: 0,
    createBufferSource() {
      const rec = { at: NaN, offset: undefined as number | undefined, rate: 1, stopped: false }
      return {
        buffer: null,
        playbackRate: { set value(v: number) { rec.rate = v } },
        connect() {},
        disconnect() {},
        start(at: number, offset?: number) {
          rec.at = at
          rec.offset = offset
          started.push(rec)
        },
        stop() {
          rec.stopped = true
        },
      } as unknown as AudioBufferSourceNode
    },
  }
  return { ctx, started }
}
const buf = { duration: DUR } as AudioBuffer
const near = (got: number[], want: number[]) => {
  expect(got).toHaveLength(want.length)
  got.forEach((g, i) => expect(g).toBeCloseTo(want[i]!, 9))
}
const dest = {} as AudioNode

describe('createScheduler', () => {
  it('plays unsynced blocks back to back, a little ahead of now', () => {
    const { ctx, started } = fakeCtx()
    let unsynced = 0
    let playing = 0
    const s = createScheduler(ctx, dest, { idealTime: () => null, onUnsynced: () => unsynced++, onPlaying: () => playing++ })
    ctx.currentTime = 5
    for (let i = 0; i < 3; i++) s.push(buf, i * BLOCK)
    near(started.map((x) => x.at), [5 + UNSYNCED_LEAD, 5 + UNSYNCED_LEAD + DUR, 5 + UNSYNCED_LEAD + 2 * DUR])
    expect([unsynced, playing, s.lastError()]).toEqual([3, 1, null])
  })

  it('places synced blocks at their ideal time and butts them together', () => {
    const { ctx, started } = fakeCtx()
    const s = createScheduler(ctx, dest, { idealTime: (n) => 2 + n / SR })
    for (let i = 0; i < 4; i++) s.push(buf, i * BLOCK)
    near(started.map((x) => x.at), [0, 1, 2, 3].map((i) => 2 + i * DUR))
    expect(started.every((x) => x.rate === 1)).toBe(true)
    expect(Math.abs(s.lastError()!)).toBeLessThan(1e-9)
  })

  it('steers a small drift with a capped playback rate', () => {
    const { ctx, started } = fakeCtx()
    let shift = 0
    const s = createScheduler(ctx, dest, { idealTime: (n) => 2 + n / SR + shift })
    s.push(buf, 0)
    shift = -0.02 // the others are now 20 ms earlier: this device is late
    s.push(buf, BLOCK)
    expect(s.lastError()).toBeCloseTo(0.02)
    expect(started[1]!.rate).toBeCloseTo(1 + PCM_MAX_RATE) // 0.02 × 0.25 is capped
    expect(started[1]!.at).toBeCloseTo(2 + DUR) // still butted to the previous block
  })

  it('reschedules waiting blocks on a big error, letting the sounding one finish', () => {
    const { ctx, started } = fakeCtx()
    let shift = 0
    const s = createScheduler(ctx, dest, { idealTime: (n) => 1 + n / SR + shift })
    for (let i = 0; i < 3; i++) s.push(buf, i * BLOCK)
    ctx.currentTime = 1.05 // block 0 is sounding
    shift = 0.2
    s.push(buf, 3 * BLOCK)
    expect(started[0]!.stopped).toBe(false)
    expect(started[1]!.stopped && started[2]!.stopped).toBe(true)
    near(started.slice(3).map((x) => x.at), [1, 2, 3].map((i) => 1.2 + i * DUR))
  })

  it('skips blocks that are already over and plays the rest of a partly late one', () => {
    const { ctx, started } = fakeCtx()
    const s = createScheduler(ctx, dest, { idealTime: (n) => n / SR })
    ctx.currentTime = 0.15
    s.push(buf, 0) // 0 → 0.1: over
    s.push(buf, BLOCK) // 0.1 → 0.2: half heard
    expect(started).toHaveLength(1)
    expect(started[0]!.at).toBe(0.15)
    expect(started[0]!.offset).toBeCloseTo(0.05)
  })
})
