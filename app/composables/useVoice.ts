import type { VoicePreset } from '#shared/types/booth'
import { TalkSender } from '~/utils/booth/talkSender'

export const VOICES: { id: VoicePreset; label: string }[] = [
  { id: 'tannoy', label: '📢 Tannoy' },
  { id: 'robot', label: '🤖 Robot' },
  { id: 'chipmunk', label: '🐿️ Chipmunk' },
  { id: 'monster', label: '👹 Monster' },
  { id: 'megaphone', label: '📣 Megaphone' },
  { id: 'vocoder', label: '🎹 Vocoder' },
  { id: 'autotune', label: '🎶 Auto-tune' },
  { id: 'underwater', label: '🫧 Underwater' },
]

/**
 * Your voice (Talkover, and the pads you record): its character and level, remembered per
 * device. Talkover plays on every listening device; this one needn't listen to talk over.
 */
export const useVoice = defineSingleton(() => {
  const voicePreset = ref<VoicePreset>((readPref('voicePreset') as VoicePreset | null) || 'tannoy')
  const voiceVolume = ref(Number(readPref('voiceVolume') ?? 1))
  const audio = () => useListening().getAudio()
  /** Talkover while this device isn't listening: mic-only, sent to the others. */
  let sender: TalkSender | null = null
  /** The voice Talkover uses right now: the listening audio's, else the sender's. */
  function channel() {
    const a = audio()
    if (a && useListening().listening.value) {
      dropSender()
      return a
    }
    if (!sender) {
      sender = new TalkSender() // inside the press: browsers start audio after a gesture
      sender.talk.setPreset(voicePreset.value)
    }
    return sender
  }
  /** Release the sender's mic and audio (listening now does the talking). */
  function dropSender() {
    sender?.close()
    sender = null
  }

  function setPreset(p: VoicePreset) {
    voicePreset.value = p
    audio()?.setVoicePreset(p)
    sender?.talk.setPreset(p)
    writePref('voicePreset', p)
  }

  function setVolume(v: number) {
    voiceVolume.value = v
    audio()?.setVoiceVolume(v)
    sender?.talk.setVolume(v)
    writePref('voiceVolume', String(v))
  }

  let talking: ReturnType<typeof channel> | null = null
  /** Talkover pressed: open the mic, heard on every listening device (this one too if it listens). */
  function start() {
    const c = (talking = channel())
    const { fxError } = useBooth()
    if (c instanceof TalkSender) c.talk.setVolume(voiceVolume.value)
    else c.setVoiceVolume(voiceVolume.value)
    const on = c instanceof TalkSender ? c.hold(true) : c.voice(true)
    on.catch((e: any) => {
      fxError.value = e?.name === 'NotAllowedError' ? 'Microphone access was refused.' : e?.message || 'No microphone.'
    })
  }

  /** Talkover let go. */
  function end() {
    const c = talking
    talking = null
    void (c instanceof TalkSender ? c.hold(false) : c?.voice(false))
  }

  return { voicePreset, voiceVolume, setPreset, setVolume, start, end, dropSender }
})
