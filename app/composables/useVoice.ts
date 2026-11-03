import type { VoicePreset } from '#shared/types/booth'

export const VOICES: { id: VoicePreset; label: string }[] = [
  { id: 'tannoy', label: '📢 Tannoy' },
  { id: 'robot', label: '🤖 Robot' },
  { id: 'chipmunk', label: '🐿️ Chipmunk' },
  { id: 'monster', label: '👹 Monster' },
]

/**
 * Your voice on this device (Talkover, and the pads you record): its character and level,
 * remembered per device. Only this device plays its own voice.
 */
export const useVoice = defineSingleton(() => {
  const voicePreset = ref<VoicePreset>((readPref('voicePreset') as VoicePreset | null) || 'tannoy')
  const voiceVolume = ref(Number(readPref('voiceVolume') ?? 1))
  const audio = () => useListening().getAudio()

  function setPreset(p: VoicePreset) {
    voicePreset.value = p
    audio()?.setVoicePreset(p)
    writePref('voicePreset', p)
  }

  function setVolume(v: number) {
    voiceVolume.value = v
    audio()?.setVoiceVolume(v)
    writePref('voiceVolume', String(v))
  }

  /** Talkover pressed: open this device's mic into its own output (with the funfair reverb). */
  function start() {
    const a = audio()
    const { fxError } = useBooth()
    if (!a || !useListening().listening.value) {
      fxError.value = 'Your voice plays on this device: tap "Listen here" here first (the music still ducks).'
      return
    }
    a.setVoiceVolume(voiceVolume.value)
    a.voice(true).catch((e: any) => {
      fxError.value = e?.name === 'NotAllowedError' ? 'Microphone access was refused.' : e?.message || 'No microphone.'
    })
  }

  return { voicePreset, voiceVolume, setPreset, setVolume, start }
})
