import { renderVoicePad } from '~/utils/booth/voice'

const MAX_SEC = 4

/**
 * Record a pad: hold the tile, speak, let go (4 s max), name it. It gets this device's voice
 * (preset, slapback, reverb), is trimmed on the server and becomes a pad on every page.
 *
 * Naming happens inline, not in a prompt(): a dialog freezes the page, and with it the live
 * stream it feeds (the music stopped while the dialog was open).
 */
export function usePadRecorder() {
  const { pads, reloadPads, showFxError } = useBooth()
  const recording = ref(false)
  /** The take waiting for a name (null: nothing recorded). */
  const take = shallowRef<Blob | null>(null)
  const name = ref('')
  const saving = ref(false)
  let wanted = false
  let recorder: MediaRecorder | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  async function start() {
    if (recording.value) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return showFxError(window.isSecureContext ? 'This browser cannot record.' : 'Recording needs the https:// address.')
    }
    wanted = true
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } })
    } catch (err: any) {
      return showFxError(err?.name === 'NotAllowedError' ? 'Microphone access was refused.' : 'No microphone.')
    }
    if (!wanted) {
      // Let go while the browser was asking for the mic.
      for (const t of stream.getTracks()) t.stop()
      return showFxError('Microphone ready: hold the tile while you speak.')
    }
    const chunks: Blob[] = []
    const rec = (recorder = new MediaRecorder(stream))
    rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data)
    rec.onstop = () => {
      for (const t of stream.getTracks()) t.stop()
      done(new Blob(chunks, { type: rec.mimeType }))
    }
    rec.start()
    recording.value = true
    navigator.vibrate?.(20)
    timer = setTimeout(stop, MAX_SEC * 1000)
  }

  function stop() {
    wanted = false
    clearTimeout(timer)
    if (recorder?.state === 'recording') recorder.stop()
    recorder = null
    recording.value = false
  }

  function done(blob: Blob) {
    if (blob.size < 500) return showFxError('Too short: hold the tile while you speak.')
    take.value = blob
    name.value = `Pad ${pads.value.filter((p) => p.recorded).length + 1}`
  }

  async function save() {
    const blob = take.value
    if (!blob || saving.value) return
    saving.value = true
    try {
      const body = await renderVoicePad(blob, useVoice().voicePreset.value).catch((e) => {
        console.error('[pads] voice render', e)
        return blob
      })
      await $fetch('/api/pads', { method: 'POST', query: { label: name.value }, body, headers: { 'content-type': body.type || 'application/octet-stream' } })
      take.value = null
      await reloadPads()
    } catch (e: any) {
      showFxError(e?.data?.statusMessage || 'Could not save the pad')
    } finally {
      saving.value = false
    }
  }

  const discard = () => (take.value = null)

  onBeforeUnmount(stop)

  return { recording, take, name, saving, start, stop, save, discard }
}
