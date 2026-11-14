import type { FavItem, Platform, PlatformStatus } from '#shared/types/music'

/** SoundCloud / Deezer connection state and the host's favorites on both. */
export const usePlatforms = defineSingleton(() => {
  const status = ref<Record<Platform, PlatformStatus> | null>(null)
  const favs = reactive<Record<Platform, FavItem[]>>({ soundcloud: [], deezer: [] })
  const favErr = reactive<Record<Platform, string>>({ soundcloud: '', deezer: '' })
  const favLoading = reactive<Record<Platform, boolean>>({ soundcloud: false, deezer: false })
  const allFavs = computed(() => [...favs.soundcloud, ...favs.deezer])
  /** A login window is open on the host. */
  const loginOpen = computed(() => !!status.value && PLATFORMS.some((p) => status.value![p].capture.interactive && status.value![p].capture.state === 'running'))
  let timer: ReturnType<typeof setTimeout> | undefined

  async function loadStatus(recheck = false) {
    clearTimeout(timer)
    try {
      const prev = status.value
      status.value = await $fetch<Record<Platform, PlatformStatus>>('/api/status', {
        query: recheck ? { recheck: '1' } : {},
      })
      // A capture just finished successfully: pull favorites.
      for (const p of PLATFORMS) {
        const was = prev?.[p]?.capture.state
        const now = status.value[p]
        if (was === 'running' && now.capture.state === 'idle' && now.connected) loadFavs(p, true)
      }
    } catch {
      /* keep last status */
    }
    const busy = status.value && PLATFORMS.some((p) => status.value![p].capture.state === 'running')
    timer = setTimeout(loadStatus, busy ? 1500 : 30_000)
  }

  /** The platform whose login browser is shown on this page (RemoteLogin.vue). */
  const loginView = ref<Platform | null>(null)

  /** Open the login browser on the server, sized to this screen, and show it here. */
  async function connect(p: Platform) {
    const size = loginViewSize()
    await $fetch(`/api/connect/${p}`, { method: 'POST', body: { ...size, dpr: devicePixelRatio || 1 } })
    loginView.value = p
    loadStatus()
  }

  async function loadFavs(p: Platform, refresh = false) {
    favLoading[p] = true
    favErr[p] = ''
    try {
      const r = await $fetch<{ items: FavItem[] }>(`/api/favorites/${p}`, { query: refresh ? { refresh: '1' } : {} })
      favs[p] = r.items
    } catch (e: any) {
      favErr[p] = e?.statusCode === 409 ? 'Login required' : errorMessage(e)
    } finally {
      favLoading[p] = false
      loadStatus()
    }
  }

  /** Dot colour and one-line summary of a platform's connection. */
  function platformState(p: Platform) {
    const s = status.value?.[p]
    if (!s) return { tone: 'muted', text: '…' }
    if (s.capture.state === 'running') return { tone: 'busy', text: s.capture.message || 'Working…' }
    if (s.capture.state === 'error' && !s.check?.ok) return { tone: 'bad', text: s.capture.message || 'Error' }
    if (!s.connected) return { tone: 'bad', text: 'Not connected' }
    if (s.check && !s.check.ok) return { tone: 'bad', text: s.check.reason === 'login required' ? 'Session expired' : s.check.reason || 'Check failed' }
    return { tone: 'ok', text: s.check?.username || s.username || 'Connected' }
  }

  async function start() {
    await loadStatus()
    for (const p of PLATFORMS) if (status.value?.[p]?.connected) loadFavs(p)
  }
  const stop = () => clearTimeout(timer)

  return { status, favs, favErr, favLoading, allFavs, loginOpen, loginView, loadStatus, connect, loadFavs, platformState, start, stop }
})

/** The login view's page size: the whole screen on a phone (under its bar), a big window on a computer. */
export function loginViewSize() {
  return { width: Math.min(innerWidth, 1100), height: Math.min(innerHeight, 860) - 48 }
}
