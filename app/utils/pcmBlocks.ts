/**
 * Turns the live MP3 stream's bytes into blocks of stereo samples, each numbered by the stream
 * sample of its first frame (the sync timeline, see server/utils/mixer.ts).
 *
 * The MP3 is CBR 192k at 48 kHz, so every frame is exactly 576 bytes and 1152 samples. Frames
 * are decoded one by one (mpg123, WebAssembly), and a frame that fails to decode still counts
 * 1152 samples (silence), so the timeline never shifts.
 */

/** Frames per scheduled block (0.1 s at 48 kHz). */
export const BLOCK = 4800
export const MP3_FRAME_BYTES = 576
export const MP3_FRAME_SAMPLES = 1152
/**
 * LAME's encoder delay plus the decoder's (576 + 529): sample s of the mix comes out of the
 * decoder at s + 1105. Measured by test/pcmBlocks.test.ts with the server's own ffmpeg command.
 */
export const MP3_DELAY = 1105

export interface RawBlock {
  ch: [Float32Array, Float32Array]
  /** Stream sample of its first frame. */
  s: number
}

/** Something that decodes one MP3 frame (mpg123-decoder's MPEGDecoder fits). */
export interface FrameDecoder {
  decodeFrame(frame: Uint8Array): { channelData: Float32Array[]; samplesDecoded: number }
}

/** Collects samples into BLOCK-sized blocks. */
class Blocker {
  private L = new Float32Array(BLOCK)
  private R = new Float32Array(BLOCK)
  private fill = 0
  constructor(private s: number) {}

  push(l: Float32Array, r: Float32Array, out: RawBlock[]) {
    let i = 0
    while (i < l.length) {
      const n = Math.min(BLOCK - this.fill, l.length - i)
      this.L.set(l.subarray(i, i + n), this.fill)
      this.R.set(r.subarray(i, i + n), this.fill)
      this.fill += n
      i += n
      if (this.fill === BLOCK) {
        out.push({ ch: [this.L, this.R], s: this.s })
        this.s += BLOCK
        this.L = new Float32Array(BLOCK)
        this.R = new Float32Array(BLOCK)
        this.fill = 0
      }
    }
  }
}

/** Bytes in, whole units of `size` bytes out (the rest waits for the next chunk). */
function framer(size: number) {
  let rest = new Uint8Array(0)
  return (chunk: Uint8Array, each: (unit: Uint8Array) => void) => {
    let data = chunk
    if (rest.length) {
      data = new Uint8Array(rest.length + chunk.length)
      data.set(rest)
      data.set(chunk, rest.length)
    }
    let off = 0
    for (; off + size <= data.length; off += size) each(data.subarray(off, off + size))
    rest = data.slice(off)
  }
}

/** The CBR MP3 stream, whose first byte is a frame starting at stream sample `start`. */
export function mp3Reader(start: number, decoder: FrameDecoder) {
  const blocker = new Blocker(start - MP3_DELAY)
  const frame = framer(MP3_FRAME_BYTES)
  return (chunk: Uint8Array): RawBlock[] => {
    const out: RawBlock[] = []
    frame(chunk, (unit) => {
      let l: Float32Array | undefined
      let r: Float32Array | undefined
      try {
        const d = decoder.decodeFrame(unit)
        if (d.samplesDecoded === MP3_FRAME_SAMPLES) {
          l = d.channelData[0]
          r = d.channelData[1] ?? l
        }
      } catch {
        /* counted as silence below */
      }
      if (!l || !r) l = r = new Float32Array(MP3_FRAME_SAMPLES)
      blocker.push(l, r, out)
    })
    return out
  }
}
