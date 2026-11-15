/**
 * The 8-bit colour's bitcrusher: each channel is held for `hold` samples (a lower sample rate,
 * with its aliasing) and rounded to `bits` bits. Runs in the voice worklet ('booth-crusher').
 */
export class CrusherCore {
  private held: number[] = []
  private left: number[] = []

  constructor(private bits = 5, private hold = 6) {}

  process(ch: number, x: Float32Array, y: Float32Array) {
    const steps = 2 ** (this.bits - 1)
    let held = this.held[ch] ?? 0
    let left = this.left[ch] ?? 0
    for (let i = 0; i < x.length; i++) {
      if (left <= 0) {
        held = Math.round(x[i]! * steps) / steps
        left = this.hold
      }
      left--
      y[i] = held
    }
    this.held[ch] = held
    this.left[ch] = left
  }
}
