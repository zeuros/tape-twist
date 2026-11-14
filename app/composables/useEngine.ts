import type { EngineSettings, EngineSnapshot, HostStatus } from '#shared/types/engine'
import type { FavItem } from '#shared/types/music'

/**
 * The server's player (decks, crossfades): polled every second, driven by commands. Also
 * hands the lock-screen / headset buttons to it.
 */
export const useEngine = defineSingleton(() => {
  const eng = ref<HostStatus | null>(null)
  const busy = ref(false)
  let engAt = 0
  let pollTimer: ReturnType<typeof setTimeout> | undefined

  function setEng(s: HostStatus) {
    eng.value = s
    engAt = Date.now()
    useEvening().sync(s.eveningRev)
    useRequests().notePending(s.pendingRequests)
  }

  async function poll() {
    clearTimeout(pollTimer)
    try {
      setEng(await $fetch<HostStatus>('/api/engine'))
    } catch {
      /* server restarting */
    }
    pollTimer = setTimeout(poll, document.hidden ? 5000 : 1000)
  }

  async function command(action: string, extra: Record<string, unknown> = {}) {
    busy.value = true
    try {
      setEng(await $fetch<HostStatus>('/api/engine', { method: 'POST', body: { action, ...extra } }))
    } catch (e: any) {
      if (eng.value) eng.value.error = errorMessage(e, 'Command failed')
    } finally {
      busy.value = false
    }
  }

  // What's about to play: shown with a spinner from the click until the deck really plays
  // (opening a deck and loading the track can take several seconds).
  const clicked = ref<EngineSnapshot['loading']>(null)
  const loadingItem = computed(() => eng.value?.loading ?? clicked.value)
  async function playNow(item: FavItem) {
    clicked.value = { id: item.id, title: item.title, artist: item.artist, artwork: item.artwork }
    try {
      await command('play', { id: item.id, item })
    } finally {
      clicked.value = null
    }
  }
  function togglePlay() {
    if (!eng.value || eng.value.status === 'stopped') {
      const first = useEvening().evening.value.items[0]
      if (first) playNow(first)
    } else command(eng.value.status === 'playing' ? 'pause' : 'resume')
  }

  // Smooth progress between polls.
  const now = ref(Date.now())
  let rafId = 0
  const shownPos = computed(() => {
    const e = eng.value
    if (!e) return 0
    const drift = e.status === 'playing' && !e.fading ? (now.value - engAt) / 1000 : 0
    return Math.min(e.durSec || 0, e.posSec + Math.max(0, drift))
  })

  let crossfadeTimer: ReturnType<typeof setTimeout> | undefined
  function setCrossfade(v: number) {
    if (eng.value) eng.value.crossfade = v
    clearTimeout(crossfadeTimer)
    crossfadeTimer = setTimeout(() => command('crossfade', { value: v }), 300)
  }

  let settingsTimer: ReturnType<typeof setTimeout> | undefined
  function setSetting<K extends keyof EngineSettings>(key: K, value: EngineSettings[K]) {
    if (!eng.value) return
    eng.value.settings = { ...eng.value.settings, [key]: value }
    clearTimeout(settingsTimer)
    settingsTimer = setTimeout(() => command('settings', { settings: eng.value!.settings }), 300)
  }

  // Lock-screen / headset controls drive the server, not the local stream.
  watch(
    () => eng.value?.current?.id,
    () => {
      const c = eng.value?.current
      nativeMeta(c?.title, c?.artist)
      if (!('mediaSession' in navigator)) return
      navigator.mediaSession.metadata = c
        ? new MediaMetadata({ title: c.title, artist: c.artist, artwork: c.artwork ? [{ src: c.artwork }] : [] })
        : null
    },
  )
  function setupMediaSession() {
    onNativeMediaAction((a) => {
      if (a === 'play') void (eng.value?.status === 'paused' ? command('resume') : togglePlay())
      else if (a === 'pause') command('pause')
      else command(a)
    })
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    ms.setActionHandler('play', () => (eng.value?.status === 'paused' ? command('resume') : togglePlay()))
    ms.setActionHandler('pause', () => command('pause'))
    ms.setActionHandler('nexttrack', () => command('next'))
    ms.setActionHandler('previoustrack', () => command('prev'))
  }

  function start() {
    poll()
    setupMediaSession()
    const frame = () => {
      now.value = Date.now()
      rafId = requestAnimationFrame(frame)
    }
    frame()
  }
  function stop() {
    clearTimeout(pollTimer)
    cancelAnimationFrame(rafId)
  }

  return { eng, busy, command, loadingItem, playNow, togglePlay, shownPos, setCrossfade, setSetting, start, stop }
})
