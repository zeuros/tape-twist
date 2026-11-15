/**
 * Talkover sent to the other devices (app/utils/voiceLink.ts), from BoothAudio while this device
 * listens, or from a TalkSender, a mic-only audio graph, while it doesn't.
 */
import { gainNode } from './dsp'
import { addVoiceModule, VoiceChannel } from './voice'
import { voiceLink } from '../voiceLink'

/** The reverb's tail, still sent once Talkover is let go. */
const VOICE_TAIL_MS = 1500

/** Sends `talk`'s voice while it's open (plus the tail). Resolves false without AudioWorklet. */
export async function sendVoice(ctx: AudioContext, talk: VoiceChannel) {
  try {
    await addVoiceModule(ctx)
  } catch {
    return false
  }
  const capture = new AudioWorkletNode(ctx, 'voice-capture', { numberOfOutputs: 1, outputChannelCount: [1] })
  talk.bus.connect(capture)
  capture.connect(gainNode(ctx, 0)).connect(ctx.destination) // pulled by the graph
  capture.port.onmessage = (e: MessageEvent<ArrayBuffer>) => voiceLink.send(e.data)
  let tail: ReturnType<typeof setTimeout> | undefined
  talk.onOpen = (open) => {
    clearTimeout(tail)
    if (open) capture.port.postMessage(true)
    else tail = setTimeout(() => capture.port.postMessage(false), VOICE_TAIL_MS)
  }
  if (talk.open) capture.port.postMessage(true) // pressed while the module loaded
  return true
}

/**
 * Talkover from a device that isn't listening: the voice only goes to the listening devices,
 * nothing plays here (no music to talk over, and no larsen from this speaker). Make it in a tap.
 */
export class TalkSender {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' })
  readonly talk: VoiceChannel
  readonly ready: Promise<boolean>

  constructor() {
    const silent = gainNode(this.ctx, 0)
    silent.connect(this.ctx.destination)
    this.talk = new VoiceChannel(this.ctx, silent)
    this.ready = sendVoice(this.ctx, this.talk)
  }

  async hold(on: boolean) {
    if (on) void this.ctx.resume()
    if (on && !(await this.ready)) throw new Error('This browser can\'t send the voice (no AudioWorklet): tap "Listen here" to talk over on this device.')
    return this.talk.hold(on)
  }

  close() {
    this.talk.closeMic()
    void this.ctx.close()
  }
}
