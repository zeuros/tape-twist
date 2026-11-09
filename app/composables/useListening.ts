import type { LiveAudio, SyncInfo } from '~/utils/liveAudio'

/**
 * "Listen here": plays the live mix on this device, in sync with every other listening
 * device (~1.2 s behind the server, app/utils/liveAudio.ts), with the booth effects played
 * on top of it (app/utils/boothAudio.ts).
 */
/** Range of the sync slider, in seconds. */
export const AHEAD_MIN = -0.2
export const AHEAD_MAX = 0.5

export const useListening = defineSingleton(() => {
  const listening = ref(false)
  const audioState = ref<'off' | 'connecting' | 'on'>('off')
  const lag = ref<number | null>(null)
  const syncInfo = ref<SyncInfo | null>(null)
  /** Seconds this device plays early, for a speaker with its own delay (Bluetooth). */
  const ahead = ref(Number(readPref('ahead') ?? 0))
  let el: HTMLAudioElement | null = null
  let live: LiveAudio | null = null
  let audio: BoothAudio | null = null
  let lagTimer: ReturnType<typeof setInterval> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  /** The page's <audio> element (a template ref). */
  const setElement = (e: unknown) => (el = e as HTMLAudioElement | null)
  /** This device's booth audio, once it has listened (null before). */
  const getAudio = () => audio
  /** How far this device is behind the server (a guess when the browser can't tell). */
  const liveLag = () => live?.lag() ?? 3

  function setAhead(v: number) {
    ahead.value = v
    writePref('ahead', String(v))
  }

  /** Auto-sync with the mic: 'busy' while listening, then a short note on the outcome. */
  const autoSync = ref<{ busy: boolean; note: string }>({ busy: false, note: '' })
  let noteTimer: ReturnType<typeof setTimeout> | undefined
  async function runAutoSync() {
    if (!audio || !listening.value || autoSync.value.busy) return
    clearTimeout(noteTimer)
    autoSync.value = { busy: true, note: 'listening to the room…' }
    let note: string
    try {
      const r = await audio.measureRoom()
      const want = ahead.value + r.shift
      const v = Math.round(Math.min(AHEAD_MAX, Math.max(AHEAD_MIN, want)) / 0.005) * 0.005
      setAhead(Number(v.toFixed(3)))
      note = want > AHEAD_MAX || want < AHEAD_MIN
        ? `auto: needs ${Math.round(want * 1000)} ms, out of range`
        : `auto-synced${r.loopback ? '' : ' (own speaker not heard: estimate)'}`
    } catch (e) {
      note = `auto-sync failed: ${(e as Error).message}`
    }
    autoSync.value = { busy: false, note }
    noteTimer = setTimeout(() => (autoSync.value.note = ''), 10000)
  }

  const syncLabel = computed(() => {
    if (!listening.value) return ''
    const s = syncInfo.value
    if (!s) return lag.value == null ? 'not synced (this browser can\'t)' : 'syncing…'
    return `in sync ±${Math.max(1, Math.round(Math.abs(s.errorMs) + s.rttMs / 2))} ms`
  })

  function start() {
    if (!el) return
    if (!audio) {
      audio = new BoothAudio(el) // inside the tap: browsers only start audio after a gesture
      useBooth().attach(audio)
    }
    void audio.resume()
    live?.stop()
    listening.value = true
    audioState.value = 'connecting'
    const opts = {
      ahead: () => ahead.value,
      outputLatency: () => audio?.outputLatency() ?? 0,
      onPlaying: () => (audioState.value = 'on'),
    }
    // MP3 through the <audio> element where the browser can (Chrome); raw PCM scheduled with
    // Web Audio where it can't (Firefox, iPhones). Both play in sync.
    // The PCM path also runs an inaudible keep-alive media element: otherwise Firefox on
    // Android suspends the page when the screen goes off (see BoothAudio.keepAlive).
    const mse = lowLatencySupported()
    audio.keepAlive(!mse)
    live = mse
      ? playLive(el, `/api/stream?t=${Date.now()}`, onTrouble, opts)
      : playPcm(audio.ctx, audio.musicIn, `/api/stream?t=${Date.now()}`, onTrouble, opts)
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
    clearInterval(lagTimer)
    lagTimer = setInterval(() => {
      lag.value = live?.lag() ?? null
      syncInfo.value = live?.sync() ?? null
    }, 1000)
  }

  function stop() {
    listening.value = false
    audioState.value = 'off'
    clearInterval(lagTimer)
    clearTimeout(retryTimer)
    live?.stop()
    live = null
    syncInfo.value = null
    audio?.stopPads()
    audio?.closeMic()
    audio?.keepAlive(false)
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'
  }

  /** The stream broke (network, server restart): reconnect in 2 s. */
  function onTrouble() {
    if (!listening.value) return
    audioState.value = 'connecting'
    clearTimeout(retryTimer)
    retryTimer = setTimeout(start, 2000)
  }

  /** Back from the lock screen: wake the audio up if the browser paused it anyway. */
  function onVisible() {
    if (document.visibilityState !== 'visible' || !listening.value || !audio) return
    void audio.resume()
    if (!lowLatencySupported()) audio.keepAlive(true)
  }

  /** Leaving the page: stop and release the audio contexts. */
  function close() {
    stop()
    audio?.close()
    audio = null
  }

  return { listening, audioState, lag, ahead, setAhead, autoSync, runAutoSync, syncLabel, setElement, getAudio, liveLag, start, stop, onTrouble, onVisible, close }
})
