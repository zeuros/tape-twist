/**
 * The Talkover voice sent live to the other devices (app/utils/voiceLink.ts): pure logic, used
 * by the AudioWorklets in app/workers/voice.worklet.ts and tested on its own.
 *
 * Frames: 20 ms of mono voice at 16 kHz, Int16, after a 4-byte header
 *   [talker slot u8 (set by the server)] [unused u8] [sequence u16 LE]
 */

export const VOICE_SR = 16000
export const VOICE_FRAME = 320 // 20 ms
export const VOICE_HEADER = 4
/** Buffered before a talker starts playing (absorbs network jitter). */
export const VOICE_START = 0.06
/** More than this buffered (a burst after a stall): drop the oldest back to VOICE_START. */
export const VOICE_MAX = 0.2
/** A gap of up to this many lost frames is filled with silence; more, and the talker restarts. */
const MAX_GAP = 25

/** Talker's side: the voice at the context's rate in, 16 kHz frames (with header room) out. */
export class VoiceFramer {
  private acc = 0
  private n = 0
  private phase = 0
  private frame = new Int16Array(VOICE_HEADER / 2 + VOICE_FRAME)
  private fill = 0
  private seq = 0

  constructor(private onFrame: (buf: ArrayBuffer) => void) {}

  /** Restart a frame from scratch (talking resumes). The sequence goes on. */
  reset() {
    this.acc = this.n = this.phase = this.fill = 0
  }

  /** Box-average down to 16 kHz: enough of a low-pass for a voice already cut at 7.5 kHz. */
  push(x: Float32Array, sr: number) {
    const inc = VOICE_SR / sr
    for (let i = 0; i < x.length; i++) {
      this.acc += x[i]!
      this.n++
      this.phase += inc
      if (this.phase < 1) continue
      this.phase -= 1
      const v = Math.max(-1, Math.min(1, this.acc / this.n))
      this.acc = this.n = 0
      this.frame[VOICE_HEADER / 2 + this.fill++] = Math.round(v * 32767)
      if (this.fill === VOICE_FRAME) this.emit()
    }
  }

  private emit() {
    const buf = this.frame.buffer.slice(0)
    new DataView(buf).setUint16(2, this.seq, true)
    this.seq = (this.seq + 1) & 0xffff
    this.fill = 0
    this.onFrame(buf)
  }
}

/** One remote talker: a jitter buffer, read at the context's rate with linear interpolation. */
class Talker {
  data = new Float32Array(VOICE_SR)
  len = 0
  pos = 0
  playing = false
  nextSeq = -1

  get buffered() {
    return this.len - this.pos
  }

  append(x: Float32Array | number) {
    const n = typeof x === 'number' ? x : x.length
    const shift = Math.floor(this.pos)
    if (shift) {
      this.data.copyWithin(0, shift, this.len)
      this.len -= shift
      this.pos -= shift
    }
    if (this.len + n > this.data.length) {
      const d = new Float32Array(Math.max(this.data.length * 2, this.len + n))
      d.set(this.data.subarray(0, this.len))
      this.data = d
    }
    if (typeof x === 'number') this.data.fill(0, this.len, this.len + n)
    else this.data.set(x, this.len)
    this.len += n
    const max = VOICE_MAX * VOICE_SR
    if (this.buffered > max) this.pos = this.len - VOICE_START * VOICE_SR
  }
}

/** Receiver's side: every remote talker's frames in, their voices summed out. */
export class VoiceMixCore {
  private talkers = new Map<number, Talker>()

  /** A frame as relayed by the server (header + Int16 samples). */
  push(buf: ArrayBuffer) {
    const v = new DataView(buf)
    const slot = v.getUint8(0)
    const seq = v.getUint16(2, true)
    const pcm = new Int16Array(buf, VOICE_HEADER)
    let t = this.talkers.get(slot)
    if (!t) this.talkers.set(slot, (t = new Talker()))
    if (t.nextSeq >= 0) {
      const gap = (seq - t.nextSeq) & 0xffff
      if (gap >= 0x8000) return // late or duplicate: already past it
      if (gap > MAX_GAP) {
        t.len = t.pos = 0
        t.playing = false
      } else if (gap) t.append(gap * VOICE_FRAME) // lost frames: silence in their place
    }
    t.nextSeq = (seq + 1) & 0xffff
    const f = new Float32Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) f[i] = pcm[i]! / 32768
    t.append(f)
  }

  /** Adds (not sets) the talkers into `out`, at context rate `sr`. */
  render(out: Float32Array, sr: number) {
    const step = VOICE_SR / sr
    for (const t of this.talkers.values()) {
      for (let i = 0; i < out.length; i++) {
        if (!t.playing) {
          if (t.buffered < VOICE_START * VOICE_SR) break
          t.playing = true
        }
        const i0 = Math.floor(t.pos)
        if (i0 + 1 >= t.len) {
          t.playing = false // ran dry: wait for VOICE_START again
          break
        }
        const a = t.data[i0]!
        out[i] = out[i]! + a + (t.data[i0 + 1]! - a) * (t.pos - i0)
        t.pos += step
      }
    }
  }
}
