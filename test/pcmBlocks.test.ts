import { spawnSync } from 'node:child_process'
import { MPEGDecoder } from 'mpg123-decoder'
import { describe, expect, it } from 'vitest'
import { BLOCK, MP3_DELAY, MP3_FRAME_BYTES, MP3_FRAME_SAMPLES, mp3Reader, type RawBlock } from '../app/utils/pcmBlocks'
import { MP3_ENCODE_ARGS } from '../server/utils/mp3'

const SR = 48000

/** Feeds `bytes` to `read` in chunks of the given sizes (cycled), collecting the blocks. */
function feed(read: (c: Uint8Array) => RawBlock[], bytes: Uint8Array, sizes: number[]) {
  const out: RawBlock[] = []
  for (let off = 0, i = 0; off < bytes.length; i++) {
    const n = sizes[i % sizes.length]!
    out.push(...read(bytes.subarray(off, off + n)))
    off += n
  }
  return out
}

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

describe('mp3Reader', () => {
  /** A fake decoder: frame k (its first byte) → 1152 samples of value k, or a failure. */
  const fake = (fail: Set<number>) => ({
    decodeFrame(f: Uint8Array) {
      const k = f[0]!
      if (fail.has(k)) return { channelData: [], samplesDecoded: 0 }
      return { channelData: [new Float32Array(MP3_FRAME_SAMPLES).fill(k), new Float32Array(MP3_FRAME_SAMPLES).fill(-k)], samplesDecoded: MP3_FRAME_SAMPLES }
    },
  })
  const nFrames = 25 // 28800 samples: 6 blocks
  const bytes = new Uint8Array(nFrames * MP3_FRAME_BYTES)
  for (let k = 0; k < nFrames; k++) bytes.fill(k, k * MP3_FRAME_BYTES, (k + 1) * MP3_FRAME_BYTES)

  it('keeps the timeline through chunking and failed frames', () => {
    const blocks = feed(mp3Reader(11520, fake(new Set([3]))), bytes, [1, 575, 100, 2000])
    expect(blocks.map((b) => b.s)).toEqual([0, 1, 2, 3, 4, 5].map((i) => 11520 - MP3_DELAY + i * BLOCK))
    const sample = (n: number) => blocks[Math.floor(n / BLOCK)]!.ch[0][n % BLOCK]
    expect(sample(2 * MP3_FRAME_SAMPLES + 5)).toBe(2)
    expect(sample(3 * MP3_FRAME_SAMPLES + 5)).toBe(0) // the failed frame is silence
    expect(sample(4 * MP3_FRAME_SAMPLES)).toBe(4)
    expect(blocks[5]!.ch[1][0]).toBe(-Math.floor((5 * BLOCK) / MP3_FRAME_SAMPLES))
  })

  it.skipIf(!hasFfmpeg)('puts every mix sample at its stream number (real encoder and decoder)', async () => {
    // A tone with a sharp click at a known sample, through the server's own encoder.
    const n = SR * 6
    const f = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) f[2 * i] = f[2 * i + 1] = 0.3 * Math.sin(i * 0.05)
    const click = 3 * SR + 1234
    for (let k = 0; k < 20; k++) f[2 * (click + k)] = f[2 * (click + k) + 1] = 0.95
    const mp3 = new Uint8Array(spawnSync('ffmpeg', MP3_ENCODE_ARGS, { input: Buffer.from(f.buffer), maxBuffer: 1e8 }).stdout)
    expect(mp3.length % MP3_FRAME_BYTES).toBe(0)

    // Join mid-stream, like a listener does (the server starts it on a frame boundary).
    for (const firstFrame of [0, 37]) {
      const d = new MPEGDecoder()
      await d.ready
      const blocks = feed(mp3Reader(firstFrame * MP3_FRAME_SAMPLES, d), mp3.subarray(firstFrame * MP3_FRAME_BYTES), [4096])
      d.free()
      let best = 0
      let at = -1
      for (const b of blocks) {
        for (let i = 1; i < BLOCK; i++) {
          const jump = Math.abs(b.ch[0][i]! - b.ch[0][i - 1]!)
          if (jump > best) [best, at] = [jump, b.s + i]
        }
      }
      expect(Math.abs(at - click)).toBeLessThanOrEqual(2)
    }
  })
})
