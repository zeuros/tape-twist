/**
 * The live player's AudioWorklet (logic: app/utils/livePlayerCore.ts). Blocks come straight
 * from the decoding worker (app/workers/mp3Stream.ts) over a MessagePort, so the page's main
 * thread is out of the audio path; the page only sends the map (where the stream should be)
 * and gets stats back four times a second.
 */
import { type LiveBlock, LivePlayerCore } from '../utils/livePlayerCore'

declare const sampleRate: number
declare const currentTime: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void

export type ToPlayer =
  | { type: 'blocks-port'; port: MessagePort }
  | { type: 'map'; s0: number; t0: number }
  | { type: 'unmap' }
  | { type: 'stop' }
export type FromPlayer = { type: 'playing' } | ({ type: 'stats' } & ReturnType<LivePlayerCore['takeStats']>)

class LivePlayer extends AudioWorkletProcessor {
  private core = new LivePlayerCore()
  private stopped = false
  private nextStats = 0

  constructor() {
    super()
    this.core.onPlaying = () => this.port.postMessage({ type: 'playing' } satisfies FromPlayer)
    this.port.onmessage = (e: MessageEvent<ToPlayer>) => {
      const m = e.data
      if (m.type === 'blocks-port') m.port.onmessage = (b: MessageEvent<LiveBlock[]>) => b.data.forEach((x) => this.core.push(x))
      else if (m.type === 'map') this.core.setMap(m.s0, m.t0)
      else if (m.type === 'unmap') this.core.clearMap()
      else this.stopped = true
    }
  }

  process(_in: Float32Array[][], outputs: Float32Array[][]) {
    if (this.stopped) return false
    const [L, R] = outputs[0]!
    this.core.render(L!, R ?? new Float32Array(L!.length), currentTime, sampleRate)
    if (currentTime >= this.nextStats) {
      this.nextStats = currentTime + 0.25
      this.port.postMessage({ type: 'stats', ...this.core.takeStats() } satisfies FromPlayer)
    }
    return true
  }
}

registerProcessor('live-player', LivePlayer)
