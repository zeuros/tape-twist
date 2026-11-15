/**
 * Talkover to every device (app/utils/voiceLink.ts), logic in app/utils/voiceJitter.ts:
 *   'voice-capture': this device's voice in, 16 kHz frames out over the port while on.
 *   'voice-player': the other devices' frames in over the port, their voices out.
 *   'voice-autotune': the auto-tune voice preset (app/utils/booth/autotune.ts).
 */
import { AutoTuneCore } from '../utils/booth/autotune'
import { VoiceFramer, VoiceMixCore } from '../utils/voiceJitter'

declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void

class VoiceCapture extends AudioWorkletProcessor {
  private on = false
  private framer = new VoiceFramer((buf) => this.port.postMessage(buf, [buf]))

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<boolean>) => {
      if (e.data && !this.on) this.framer.reset()
      this.on = e.data
    }
  }

  process(inputs: Float32Array[][]) {
    const x = inputs[0]?.[0]
    if (this.on && x) this.framer.push(x, sampleRate)
    return true
  }
}

class VoicePlayer extends AudioWorkletProcessor {
  private core = new VoiceMixCore()

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<ArrayBuffer>) => this.core.push(e.data)
  }

  process(_in: Float32Array[][], outputs: Float32Array[][]) {
    this.core.render(outputs[0]![0]!, sampleRate)
    return true
  }
}

class VoiceAutoTune extends AudioWorkletProcessor {
  private core = new AutoTuneCore(sampleRate)

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const x = inputs[0]?.[0]
    const y = outputs[0]![0]!
    if (!x) return true // nothing connected right now (another voice picked): no work
    y.set(x)
    this.core.process(y)
    return true
  }
}

registerProcessor('voice-capture', VoiceCapture)
registerProcessor('voice-autotune', VoiceAutoTune)
registerProcessor('voice-player', VoicePlayer)
