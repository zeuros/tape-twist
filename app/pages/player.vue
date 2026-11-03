<script setup lang="ts">
import type { ColorPreset, VoicePreset, XY } from '~/utils/boothAudio'
import type { LiveAudio, SyncInfo } from '~/utils/liveAudio'
type Platform = 'soundcloud' | 'deezer'
interface FavItem {
  id: string
  platform: Platform
  kind: 'track' | 'playlist'
  nativeId: string
  title: string
  artist: string
  durationSec: number
  url: string
  artwork?: string
  embedUrl: string
  genre?: string
  addedAt?: string
  trackCount?: number
}
interface EveningEntry extends FavItem {
  mood?: string
  note?: string
  requestedBy?: string
}
interface Playlist {
  id: string
  title: string
  startTime: string
  items: EveningEntry[]
}
interface Evening {
  playlists: Playlist[]
  open: string
  rev?: number
}
interface PlatformStatus {
  connected: boolean
  capturedAt?: string
  username?: string
  check?: { ok: boolean; username?: string; reason?: string; at: number }
  capture: { state: 'idle' | 'running' | 'error'; message?: string; interactive?: boolean }
  favorites: { count: number; fetchedAt: string } | null
}

const PLATFORMS: Platform[] = ['soundcloud', 'deezer']
const LABEL: Record<Platform, string> = { soundcloud: 'SoundCloud', deezer: 'Deezer' }
const MOODS = [
  { id: 'chill', label: 'Chill' },
  { id: 'feels', label: 'Feels' },
  { id: 'groove', label: 'Groove' },
  { id: 'deep', label: 'Deep' },
  { id: 'winddown', label: 'Wind-down' },
]

// ------------------------------------------------------------------ status
const status = ref<Record<Platform, PlatformStatus> | null>(null)
let statusTimer: ReturnType<typeof setTimeout> | undefined

async function loadStatus(recheck = false) {
  clearTimeout(statusTimer)
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
  statusTimer = setTimeout(loadStatus, busy ? 1500 : 30_000)
}

async function connect(p: Platform) {
  await $fetch(`/api/connect/${p}`, { method: 'POST' })
  loadStatus()
}

function platformState(p: Platform) {
  const s = status.value?.[p]
  if (!s) return { tone: 'muted', text: '…' }
  if (s.capture.state === 'running') return { tone: 'busy', text: s.capture.message || 'Working…' }
  if (s.capture.state === 'error' && !s.check?.ok) return { tone: 'bad', text: s.capture.message || 'Error' }
  if (!s.connected) return { tone: 'bad', text: 'Not connected' }
  if (s.check && !s.check.ok) return { tone: 'bad', text: s.check.reason === 'login required' ? 'Session expired' : s.check.reason || 'Check failed' }
  return { tone: 'ok', text: s.check?.username || s.username || 'Connected' }
}

// --------------------------------------------------------------- favorites
const favs = reactive<Record<Platform, FavItem[]>>({ soundcloud: [], deezer: [] })
const favErr = reactive<Record<Platform, string>>({ soundcloud: '', deezer: '' })
const favLoading = reactive<Record<Platform, boolean>>({ soundcloud: false, deezer: false })

async function loadFavs(p: Platform, refresh = false) {
  favLoading[p] = true
  favErr[p] = ''
  try {
    const r = await $fetch<{ items: FavItem[] }>(`/api/favorites/${p}`, { query: refresh ? { refresh: '1' } : {} })
    favs[p] = r.items
  } catch (e: any) {
    favErr[p] = e?.statusCode === 409 ? 'Login required' : e?.data?.statusMessage || e?.message || 'Failed'
  } finally {
    favLoading[p] = false
    loadStatus()
  }
}

const q = ref('')
const source = ref<'all' | Platform>('all')
const kind = ref<'all' | 'track' | 'playlist' | 'long'>('all')
const sort = ref<'added' | 'title' | 'artist' | 'duration'>('added')
const shown = ref(150)

const allFavs = computed(() => [...favs.soundcloud, ...favs.deezer])
const filtered = computed(() => {
  const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean)
  let list = allFavs.value.filter((f) => {
    if (source.value !== 'all' && f.platform !== source.value) return false
    if (kind.value === 'long' && f.durationSec < 20 * 60) return false
    if ((kind.value === 'track' || kind.value === 'playlist') && f.kind !== kind.value) return false
    if (!terms.length) return true
    const hay = `${f.title} ${f.artist} ${f.genre ?? ''}`.toLowerCase()
    return terms.every((t) => hay.includes(t))
  })
  const by = sort.value
  list = [...list].sort((a, b) =>
    by === 'title' ? a.title.localeCompare(b.title)
    : by === 'artist' ? a.artist.localeCompare(b.artist)
    : by === 'duration' ? b.durationSec - a.durationSec
    : (b.addedAt ?? '').localeCompare(a.addedAt ?? ''),
  )
  return list
})
watch([q, source, kind, sort], () => (shown.value = 150))

// Beyond the favorites: the whole SoundCloud and Deezer catalogs.
const catalog = ref<FavItem[]>([])
const catalogLoading = ref(false)
let catalogTimer: ReturnType<typeof setTimeout> | undefined
const favIds = computed(() => new Set(allFavs.value.map((f) => f.id)))
const catalogShown = computed(() =>
  catalog.value.filter((f) => {
    if (favIds.value.has(f.id)) return false
    if (source.value !== 'all' && f.platform !== source.value) return false
    if (kind.value === 'long' && f.durationSec < 20 * 60) return false
    if ((kind.value === 'track' || kind.value === 'playlist') && f.kind !== kind.value) return false
    return true
  }),
)
watch(q, (v) => {
  clearTimeout(catalogTimer)
  const query = v.trim()
  if (query.length < 2) {
    catalog.value = []
    catalogLoading.value = false
    return
  }
  catalogLoading.value = true
  catalogTimer = setTimeout(async () => {
    const r = await $fetch<FavItem[]>('/api/search', { query: { q: query } }).catch(() => [])
    if (q.value.trim() === query) {
      catalog.value = r
      catalogLoading.value = false
    }
  }, 350)
})

// ----------------------------------------------------------------- evening
const doc = ref<Evening>({ playlists: [{ id: 'main', title: 'Chill & feels', startTime: '20:00', items: [] }], open: 'main', rev: 0 })
/** The open playlist: the one being edited, where new songs land. */
const evening = computed(() => doc.value.playlists.find((p) => p.id === doc.value.open) ?? doc.value.playlists[0])
const listSec = (p: Playlist) => p.items.reduce((s, i) => s + (i.durationSec || 0), 0)
function newPlaylist() {
  const id = `pl-${Date.now().toString(36)}`
  doc.value.playlists.push({ id, title: `Playlist ${doc.value.playlists.length + 1}`, startTime: evening.value.startTime, items: [] })
  doc.value.open = id
}
function deletePlaylist(p: Playlist) {
  if (doc.value.playlists.length < 2) return
  if (p.items.length && !confirm(`Delete "${p.title}" and its ${p.items.length} songs?`)) return
  const i = doc.value.playlists.indexOf(p)
  doc.value.playlists.splice(i, 1)
  doc.value.open = doc.value.playlists[Math.max(0, i - 1)].id
}
const inEvening = computed(() => new Set(evening.value.items.map((i) => i.id)))
let saveTimer: ReturnType<typeof setTimeout> | undefined
const saved = ref(true)

// Changes that come from the server (another device, an approved guest request) must not
// be saved back, or two open players would bounce the list between them forever.
let applyingRemote = false
function applyEvening(e: Evening) {
  applyingRemote = true
  doc.value = e
  nextTick(() => (applyingRemote = false))
}

watch(
  doc,
  () => {
    if (applyingRemote) return
    saved.value = false
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveEvening, 600)
  },
  { deep: true },
)

async function saveEvening() {
  saveTimer = undefined
  try {
    const r = await $fetch<Evening>('/api/evening', { method: 'PUT', body: doc.value })
    applyingRemote = true
    doc.value.rev = r.rev
    nextTick(() => (applyingRemote = false))
  } catch (e: any) {
    // Someone else changed it first: take their version.
    if (e?.statusCode === 409 && e?.data?.data) applyEvening(e.data.data)
  } finally {
    saved.value = true
  }
}

async function syncEvening(serverRev?: number) {
  if (serverRev === undefined || serverRev === doc.value.rev || saveTimer || !saved.value) return
  applyEvening(await $fetch<Evening>('/api/evening'))
}

// ---------------------------------------------------------------- ask Claude
// One line at the top of the playlist: Claude finds songs, they're added to that playlist.
type MixMethod = 'pick' | 'dig' | 'favs'
const MIX_METHODS: { id: MixMethod; label: string; title: string }[] = [
  { id: 'pick', label: '🧠 Pick', title: 'Claude names songs from what it knows; each is searched on SoundCloud and Deezer (fast, sometimes not found)' },
  { id: 'dig', label: '⛏️ Dig', title: 'Claude writes searches, the server gathers real tracks (+ SoundCloud related of the reference), Claude picks from them' },
  { id: 'favs', label: '♥ Favs', title: 'Claude picks among your liked tracks' },
]
const aiPrompt = ref('')
const aiCount = ref(Number(safeStorage('aiCount')) || 10)
const aiMethod = ref<MixMethod>((safeStorage('aiMethod') as MixMethod | null) || 'pick')
const aiBusy = ref(false)
const aiStatus = ref('')
watch(aiCount, (v) => safeStorage('aiCount', String(v)))
watch(aiMethod, (v) => safeStorage('aiMethod', v))
async function askClaude() {
  const prompt = aiPrompt.value.trim()
  if (!prompt || aiBusy.value) return
  const target = evening.value
  aiBusy.value = true
  aiStatus.value = 'Claude is choosing…'
  try {
    const r = await $fetch<{ items: FavItem[]; missing: string[]; note: string; ms: number }>('/api/ai/mix', {
      method: 'POST',
      body: {
        prompt,
        count: Math.max(1, Math.min(40, aiCount.value || 10)),
        method: aiMethod.value,
        playlistTitle: target.title,
        current: target.items.map((i) => ({ artist: i.artist, title: i.title })),
      },
    })
    const pl = doc.value.playlists.find((p) => p.id === target.id) ?? evening.value
    const have = new Set(pl.items.map((i) => i.id))
    const added = r.items.filter((f) => !have.has(f.id))
    pl.items.push(...added.map((f) => ({ ...f, mood: 'chill' })))
    aiStatus.value = `+${added.length} in ${(r.ms / 1000).toFixed(0)} s${r.missing.length ? ` · not found: ${r.missing.join(', ')}` : ''}${r.note ? ` · ${r.note}` : ''}`
  } catch (e: any) {
    aiStatus.value = e?.data?.statusMessage || e?.message || 'Claude failed'
  } finally {
    aiBusy.value = false
  }
}

function addToEvening(f: FavItem) {
  if (inEvening.value.has(f.id)) return
  evening.value.items.push({ ...f, mood: 'chill' })
}
function removeAt(i: number) {
  evening.value.items.splice(i, 1)
}
function move(i: number, d: number) {
  const j = i + d
  const items = evening.value.items
  if (j < 0 || j >= items.length) return
  ;[items[i], items[j]] = [items[j], items[i]]
}

const dragFrom = ref<number | null>(null)
function onDrop(to: number) {
  const from = dragFrom.value
  dragFrom.value = null
  if (from === null || from === to) return
  const [it] = evening.value.items.splice(from, 1)
  evening.value.items.splice(to, 0, it)
}

// Touch reorder: the ⠿ handle follows the finger (HTML5 drag-and-drop doesn't exist on
// phones). The item moves as soon as the finger is over another entry.
function handleDown(e: PointerEvent, i: number) {
  e.preventDefault()
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  dragFrom.value = i
  navigator.vibrate?.(10)
}
function handleMove(e: PointerEvent) {
  const from = dragFrom.value
  if (from === null) return
  // Scroll when the finger nears the top, or the player bar at the bottom.
  if (e.clientY < 70) window.scrollBy(0, -14)
  else if (e.clientY > window.innerHeight - 190) window.scrollBy(0, 14)
  const li = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('li.ev')
  const to = Number(li?.dataset.i)
  if (!li || Number.isNaN(to) || to === from) return
  const [it] = evening.value.items.splice(from, 1)
  evening.value.items.splice(to, 0, it)
  dragFrom.value = to
}
function handleUp() {
  dragFrom.value = null
}

const schedule = computed(() => {
  const [h, m] = evening.value.startTime.split(':').map(Number)
  let t = (h || 0) * 3600 + (m || 0) * 60
  return evening.value.items.map((it) => {
    const start = t
    t += it.durationSec
    return start
  })
})
const totalSec = computed(() => evening.value.items.reduce((s, i) => s + i.durationSec, 0))
const endClock = computed(() => {
  const [h, m] = evening.value.startTime.split(':').map(Number)
  return clock((h || 0) * 3600 + (m || 0) * 60 + totalSec.value)
})

// ------------------------------------------------------------------ remote
interface EngineState {
  status: 'stopped' | 'playing' | 'paused'
  fading: boolean
  current: FavItem | null
  currentId: string | null
  adhoc: boolean
  posSec: number
  durSec: number
  next: { id: string; title: string; artist: string } | null
  crossfade: number
  settings: { crossfade: number; bassSwap: boolean; autoPauseHours: number; idlePauseMin: number }
  listeners: number
  error: string
  notice: string
  eveningRev: number
  pendingRequests: number
}
const eng = ref<EngineState | null>(null)
const busy = ref(false)
let engTimer: ReturnType<typeof setTimeout> | undefined
let engAt = 0

function setEng(s: EngineState) {
  eng.value = s
  engAt = Date.now()
  syncEvening(s.eveningRev)
  if (s.pendingRequests !== lastPending) {
    lastPending = s.pendingRequests
    loadRequests()
  }
}

async function pollEngine() {
  clearTimeout(engTimer)
  try {
    setEng(await $fetch<EngineState>('/api/engine'))
  } catch {
    /* server restarting */
  }
  engTimer = setTimeout(pollEngine, document.hidden ? 5000 : 1000)
}

async function command(action: string, extra: Record<string, unknown> = {}) {
  busy.value = true
  try {
    setEng(await $fetch<EngineState>('/api/engine', { method: 'POST', body: { action, ...extra } }))
  } catch (e: any) {
    if (eng.value) eng.value.error = e?.data?.statusMessage || e?.message || 'Command failed'
  } finally {
    busy.value = false
  }
}

function playNow(item: FavItem) {
  command('play', { id: item.id, item })
}
function togglePlay() {
  if (!eng.value || eng.value.status === 'stopped') {
    const first = evening.value.items[0]
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
function onSeek(ev: MouseEvent) {
  const e = eng.value
  if (!e?.durSec) return
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  command('seek', { value: ((ev.clientX - r.left) / r.width) * e.durSec })
}
let crossfadeTimer: ReturnType<typeof setTimeout> | undefined
function onCrossfade(v: number) {
  if (eng.value) eng.value.crossfade = v
  clearTimeout(crossfadeTimer)
  crossfadeTimer = setTimeout(() => command('crossfade', { value: v }), 300)
}

// ---------------------------------------------------- listen on this device
const audioEl = ref<HTMLAudioElement | null>(null)
const listening = ref(false)
const audioState = ref<'off' | 'connecting' | 'on'>('off')
let retryTimer: ReturnType<typeof setTimeout> | undefined

// Synced playback (see app/utils/liveAudio.ts): every listening device plays the same
// instant, ~1.2 s behind the server. The booth effects are played here on top of it
// (app/utils/boothAudio.ts), so they're instant.
const lag = ref<number | null>(null)
const syncInfo = ref<SyncInfo | null>(null)
/** Seconds this device plays early, for a speaker with its own delay (Bluetooth). */
const ahead = ref(Number(safeStorage('ahead') ?? 0))
function setAhead(v: number) {
  ahead.value = v
  safeStorage('ahead', String(v))
}
const syncLabel = computed(() => {
  if (!listening.value) return ''
  const s = syncInfo.value
  if (!s) return lag.value == null ? 'not synced (this browser can\'t)' : 'syncing…'
  return `in sync ±${Math.max(1, Math.round(Math.abs(s.errorMs) + s.rttMs / 2))} ms`
})
let live: LiveAudio | null = null
let lagTimer: ReturnType<typeof setInterval> | undefined
let audio: BoothAudio | null = null

function startListening() {
  const a = audioEl.value
  if (!a) return
  if (!audio) {
    audio = new BoothAudio(a) // inside the tap: browsers only start audio after a gesture
    audio.setVoicePreset(voicePreset.value)
    applyBooth()
    audio.loadPads(pads.value)
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
  // The PCM path also plays out through a hidden <audio> element: otherwise Firefox on
  // Android suspends it when the screen goes off.
  const mse = lowLatencySupported()
  audio.playThroughElement(!mse)
  live = mse
    ? playLive(a, `/api/stream?t=${Date.now()}`, onAudioTrouble, opts)
    : playPcm(audio.ctx, audio.musicIn, `/api/stream?format=pcm&t=${Date.now()}`, onAudioTrouble, opts)
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
  clearInterval(lagTimer)
  lagTimer = setInterval(() => {
    lag.value = live?.lag() ?? null
    syncInfo.value = live?.sync() ?? null
  }, 1000)
}
function stopListening() {
  listening.value = false
  audioState.value = 'off'
  clearInterval(lagTimer)
  clearTimeout(retryTimer)
  live?.stop()
  live = null
  syncInfo.value = null
  audio?.stopPads()
  audio?.closeMic()
  audio?.playThroughElement(false)
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'
}
function onAudioTrouble() {
  if (!listening.value) return
  audioState.value = 'connecting'
  clearTimeout(retryTimer)
  retryTimer = setTimeout(startListening, 2000)
}

// Lock-screen / headset controls drive the server, not the local stream.
watch(
  () => eng.value?.current?.id,
  () => {
    if (!('mediaSession' in navigator)) return
    const c = eng.value?.current
    navigator.mediaSession.metadata = c
      ? new MediaMetadata({ title: c.title, artist: c.artist, artwork: c.artwork ? [{ src: c.artwork }] : [] })
      : null
  },
)
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return
  const ms = navigator.mediaSession
  ms.setActionHandler('play', () => (eng.value?.status === 'paused' ? command('resume') : togglePlay()))
  ms.setActionHandler('pause', () => command('pause'))
  ms.setActionHandler('nexttrack', () => command('next'))
  ms.setActionHandler('previoustrack', () => command('prev'))
}

// ------------------------------------------------------------------- booth
// The server holds the shared booth state and relays every change and pad hit to all open
// pages (server-sent events). Each listening page plays the effects itself, so the page
// you press on reacts at once, and the other listening devices follow within a few ms.
interface Booth {
  eq: { low: number; mid: number; high: number }
  color: ColorPreset
  duckDb: number
  padVolume: number
  talkover: boolean
  echo: boolean
  brake: boolean
  xy: XY | null
  pads: string[]
}
type BoothEvent =
  | { type: 'state'; state: Booth; from?: string }
  | { type: 'pad'; id: string; on: boolean; from?: string }
  | { type: 'stopPads'; from?: string }
  | { type: 'echoOut'; from?: string }
  | { type: 'padsChanged'; from?: string }
interface Pad {
  id: string
  emoji: string
  label: string
  durationSec?: number
  recorded?: boolean
}
const pads = ref<Pad[]>([])
const fxError = ref('')
const booth = ref<Booth>({ eq: { low: 0, mid: 0, high: 0 }, color: 'off', duckDb: 10, padVolume: 0.8, talkover: false, echo: false, brake: false, xy: null, pads: [] })
const clientId = Math.random().toString(36).slice(2)
let eqEditedAt = 0
let events: EventSource | null = null
const COLORS = [
  { id: 'off', label: 'Clean', emoji: '✨' },
  { id: 'radio', label: 'Old radio', emoji: '📻' },
  { id: 'phone', label: 'Phone', emoji: '☎️' },
  { id: 'vinyl', label: 'Vinyl', emoji: '💿' },
] as const
const EQ_BANDS = [
  { id: 'low', label: 'Low' },
  { id: 'mid', label: 'Mid' },
  { id: 'high', label: 'High' },
] as const

function setBooth(s: Booth) {
  // While a slider is being dragged here, the server's echo of an older value would jump it back.
  if (Date.now() - eqEditedAt < 1000) s = { ...s, eq: booth.value.eq }
  booth.value = s
}

function connectBooth() {
  events = new EventSource('/api/fx/events') // reconnects by itself
  events.onmessage = (m) => {
    const e = JSON.parse(m.data) as BoothEvent
    if (e.type === 'state') return setBooth(e.state)
    if (e.type === 'padsChanged') return void reloadPads()
    if (e.from === clientId) return // already played here
    if (e.type === 'pad') void audio?.pad(e.id, e.on)
    else if (e.type === 'stopPads') audio?.stopPads()
    else if (e.type === 'echoOut') audio?.echoOut(liveLag())
  }
}

/** How far this device is behind the server (a guess when the browser can't tell). */
const liveLag = () => live?.lag() ?? 3

/** Hold buttons pressed here count at once, before the server confirms. */
const held = reactive<Record<string, boolean>>({})
/** XY pad position under this device's finger (null when not touching it here). */
const xyLocal = ref<XY | null>(null)
function applyBooth() {
  if (!audio) return
  const b = booth.value
  audio.setEq(b.eq)
  audio.setColor(b.color)
  audio.setDuckDb(b.duckDb)
  audio.setPadVolume(b.padVolume)
  audio.setTalkover(!!held.talkover || b.talkover)
  audio.setEcho(!!held.echo || b.echo)
  audio.setBrake(!!held.brake || b.brake)
  audio.setXY(xyLocal.value ?? b.xy)
}
watch([booth, () => held.talkover, () => held.echo, () => held.brake, xyLocal], applyBooth, { deep: true })

async function fx(action: string, extra: Record<string, unknown> = {}) {
  fxError.value = ''
  try {
    setBooth(await $fetch<Booth>('/api/fx', { method: 'POST', body: { action, from: clientId, ...extra } }))
  } catch (e: any) {
    fxError.value = e?.data?.statusMessage || e?.message || 'Failed'
    setTimeout(() => (fxError.value = ''), 4000)
  }
}

// Pads fire on press with a mouse (instant), but on a touch screen only on a real tap:
// lifting the finger where it went down. A finger that scrolls the page doesn't fire.
const padTouches = new Map<number, { x: number; y: number }>()
const TAP_SLOP = 10
function padDown(e: PointerEvent, p: Pad) {
  if (e.pointerType === 'mouse') {
    e.preventDefault()
    hitPad(p)
  } else padTouches.set(e.pointerId, { x: e.clientX, y: e.clientY })
}
function padMove(e: PointerEvent) {
  const t = padTouches.get(e.pointerId)
  if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) > TAP_SLOP) padTouches.delete(e.pointerId)
}
function padUp(e: PointerEvent, p: Pad) {
  const t = padTouches.get(e.pointerId)
  padTouches.delete(e.pointerId)
  if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) <= TAP_SLOP) hitPad(p)
}
function hitPad(p: Pad) {
  if (!listening.value && !eng.value?.listeners) {
    fxError.value = 'Pads play on the listening devices: tap "Listen here" first.'
    setTimeout(() => (fxError.value = ''), 4000)
    return
  }
  // Every pad toggles: tap it again while it plays to stop it.
  const on = !(audio ? audio.isPlaying(p.id) : booth.value.pads.includes(p.id))
  void audio?.pad(p.id, on)
  booth.value.pads = on ? [...booth.value.pads, p.id] : booth.value.pads.filter((x) => x !== p.id)
  fx('pad', { id: p.id, on })
  navigator.vibrate?.(15)
}

function stopPads() {
  audio?.stopPads()
  booth.value.pads = []
  fx('stopPads')
}

function setColor(c: ColorPreset) {
  booth.value.color = c
  fx('color', { color: c })
}

function setFxValue(action: 'duck' | 'padVolume', value: number) {
  booth.value[action === 'duck' ? 'duckDb' : 'padVolume'] = value
  fx(action, { value })
}

function echoOut() {
  audio?.echoOut(liveLag())
  fx('echoOut')
}

let eqTimer: ReturnType<typeof setTimeout> | undefined
function setEq(band: 'low' | 'mid' | 'high', v: number) {
  booth.value.eq = { ...booth.value.eq, [band]: v }
  eqEditedAt = Date.now()
  clearTimeout(eqTimer)
  eqTimer = setTimeout(() => fx('eq', { eq: booth.value.eq }), 60)
}
function resetEq() {
  booth.value.eq = { low: 0, mid: 0, high: 0 }
  eqEditedAt = Date.now()
  fx('eq', { eq: booth.value.eq })
}
const eqLabel = (v: number) => (v <= -26 ? 'kill' : `${v > 0 ? '+' : ''}${v} dB`)

/** Hold buttons: "on" + keep-alive every 2 s while pressed (server releases after 6 s otherwise). */
const holdTimers: Record<string, ReturnType<typeof setInterval>> = {}
function holdStart(name: 'talkover' | 'echo' | 'brake', ev: PointerEvent) {
  try {
    ;(ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId)
  } catch {
    /* no active pointer (synthetic event): capture is only a nicety */
  }
  if (held[name]) return
  held[name] = true
  if (name === 'talkover') startVoice()
  fx(name, { on: true })
  holdTimers[name] = setInterval(() => fx(name, { on: true }), 2000)
  navigator.vibrate?.(10)
}
function holdEnd(name: 'talkover' | 'echo' | 'brake') {
  if (!held[name]) return
  held[name] = false
  if (name === 'talkover') void audio?.voice(false)
  clearInterval(holdTimers[name])
  fx(name, { on: false })
}

// XY pad: the finger position drives a DJ filter (x) and resonance + echo (y) on every
// listening device. Applied here at once; sent at most every 60 ms, kept alive every 2 s.
const xyShown = computed(() => xyLocal.value ?? booth.value.xy)
let xySentAt = 0
let xyTimer: ReturnType<typeof setTimeout> | undefined
let xyKeep: ReturnType<typeof setInterval> | undefined
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
function xyAt(e: PointerEvent): XY {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01(1 - (e.clientY - r.top) / r.height) }
}
function xySend() {
  clearTimeout(xyTimer)
  if (!xyLocal.value) return
  const wait = 60 - (Date.now() - xySentAt)
  if (wait > 0) {
    xyTimer = setTimeout(xySend, wait)
    return
  }
  xySentAt = Date.now()
  fx('xy', { ...xyLocal.value, on: true })
}
function xyDown(e: PointerEvent) {
  e.preventDefault()
  try {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  } catch {
    /* synthetic event */
  }
  xyLocal.value = xyAt(e)
  xySend()
  clearInterval(xyKeep)
  xyKeep = setInterval(() => xyLocal.value && fx('xy', { ...xyLocal.value, on: true }), 2000)
  navigator.vibrate?.(10)
}
function xyMove(e: PointerEvent) {
  if (!xyLocal.value) return
  xyLocal.value = xyAt(e)
  xySend()
}
function xyUp() {
  if (!xyLocal.value) return
  xyLocal.value = null
  clearTimeout(xyTimer)
  clearInterval(xyKeep)
  booth.value.xy = null
  fx('xy', { on: false })
}

// Record a pad: hold the tile, speak, let go (4 s max). It's trimmed on the server and
// becomes a pad on every page.
const recording = ref(false)
let recWanted = false
let recorder: MediaRecorder | null = null
let recTimer: ReturnType<typeof setTimeout> | undefined
async function recStart(e: PointerEvent) {
  e.preventDefault()
  try {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  } catch {
    /* synthetic event */
  }
  if (recording.value) return
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return showFxError(window.isSecureContext ? 'This browser cannot record.' : 'Recording needs the https:// address.')
  }
  recWanted = true
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } })
  } catch (err: any) {
    return showFxError(err?.name === 'NotAllowedError' ? 'Microphone access was refused.' : 'No microphone.')
  }
  if (!recWanted) {
    // Let go while the browser was asking for the mic.
    for (const t of stream.getTracks()) t.stop()
    return showFxError('Microphone ready: hold the tile while you speak.')
  }
  const chunks: Blob[] = []
  const rec = (recorder = new MediaRecorder(stream))
  rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data)
  rec.onstop = () => {
    for (const t of stream.getTracks()) t.stop()
    void uploadPad(new Blob(chunks, { type: rec.mimeType }))
  }
  rec.start()
  recording.value = true
  navigator.vibrate?.(20)
  recTimer = setTimeout(recEnd, 4000)
}
function recEnd() {
  recWanted = false
  clearTimeout(recTimer)
  if (recorder?.state === 'recording') recorder.stop()
  recorder = null
  recording.value = false
}
async function uploadPad(blob: Blob) {
  if (blob.size < 500) return showFxError('Too short: hold the tile while you speak.')
  const label = prompt('Name your pad', `Pad ${pads.value.filter((p) => p.recorded).length + 1}`)
  if (label === null) return
  try {
    await $fetch('/api/pads', { method: 'POST', query: { label }, body: blob, headers: { 'content-type': blob.type || 'application/octet-stream' } })
    await reloadPads()
  } catch (e: any) {
    showFxError(e?.data?.statusMessage || 'Could not save the pad')
  }
}
async function deletePad(p: Pad) {
  if (!confirm(`Delete the pad "${p.label}"?`)) return
  await $fetch(`/api/pads/${encodeURIComponent(p.id)}`, { method: 'DELETE' }).catch(() => showFxError('Could not delete the pad'))
  await reloadPads()
}
async function reloadPads() {
  pads.value = await $fetch<Pad[]>('/api/pads').catch(() => pads.value)
  audio?.loadPads(pads.value)
}
function showFxError(msg: string) {
  fxError.value = msg
  setTimeout(() => (fxError.value = ''), 4000)
}

/** Talkover voice character, per device (only this device plays its voice). */
const VOICES: { id: VoicePreset; label: string }[] = [
  { id: 'tannoy', label: '📢 Tannoy' },
  { id: 'robot', label: '🤖 Robot' },
  { id: 'chipmunk', label: '🐿️ Chipmunk' },
  { id: 'monster', label: '👹 Monster' },
]
const voicePreset = ref<VoicePreset>((safeStorage('voicePreset') as VoicePreset | null) || 'tannoy')
function setVoicePreset(p: VoicePreset) {
  voicePreset.value = p
  audio?.setVoicePreset(p)
  safeStorage('voicePreset', p)
}

/** Talkover also opens this device's mic into its own output (with the funfair reverb). */
const voiceVolume = ref(Number(safeStorage('voiceVolume') ?? 1))
function startVoice() {
  if (!audio || !listening.value) {
    fxError.value = 'Your voice plays on this device: tap "Listen here" here first (the music still ducks).'
    return
  }
  audio.setVoiceVolume(voiceVolume.value)
  audio.voice(true).catch((e: any) => {
    fxError.value = e?.name === 'NotAllowedError' ? 'Microphone access was refused.' : e?.message || 'No microphone.'
  })
}
function setVoiceVolume(v: number) {
  voiceVolume.value = v
  audio?.setVoiceVolume(v)
  safeStorage('voiceVolume', String(v))
}
function safeStorage(key: string, value?: string) {
  try {
    if (value === undefined) return localStorage.getItem(`evening.${key}`)
    localStorage.setItem(`evening.${key}`, value)
  } catch {
    /* private mode: just not remembered */
  }
  return null
}

let settingsTimer: ReturnType<typeof setTimeout> | undefined
function setSetting(key: keyof EngineState['settings'], value: number | boolean) {
  if (!eng.value) return
  eng.value.settings = { ...eng.value.settings, [key]: value }
  clearTimeout(settingsTimer)
  settingsTimer = setTimeout(() => command('settings', { settings: eng.value!.settings }), 300)
}

// ---------------------------------------------------------------- requests
interface HostRequest {
  id: string
  item: FavItem
  guestName: string
  votes: number
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
}
const requests = ref<HostRequest[]>([])
let lastPending = -1
const pending = computed(() => requests.value.filter((r) => r.status === 'pending'))
const decided = computed(() => requests.value.filter((r) => r.status !== 'pending').slice(0, 8))
async function loadRequests() {
  requests.value = await $fetch<HostRequest[]>('/api/requests').catch(() => requests.value)
}
async function decideRequest(r: HostRequest, action: 'approve' | 'reject') {
  r.status = action === 'approve' ? 'approved' : 'rejected'
  await $fetch(`/api/requests/${r.id}`, { method: 'POST', body: { action } }).catch(() => {})
  await loadRequests()
  if (action === 'approve') applyEvening(await $fetch<Evening>('/api/evening'))
}
const lanIp = ref<string | null>(null)
const guestUrl = computed(() => {
  if (!import.meta.client) return '/'
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  const host = local && lanIp.value ? `${lanIp.value}${location.port ? `:${location.port}` : ''}` : location.host
  return `${location.protocol}//${host}/`
})

// ------------------------------------------------------------------ format
function dur(s: number) {
  if (!s) return '–'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}
function clock(s: number) {
  const d = Math.floor(s / 60) % (24 * 60)
  return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`
}
function ago(iso?: string) {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

const tab = ref<'favs' | 'evening' | 'booth' | 'requests'>('favs')

let started = false
async function start() {
  if (started) return
  started = true
  await loadStatus()
  applyEvening(await $fetch<Evening>('/api/evening'))
  for (const p of PLATFORMS) if (status.value?.[p]?.connected) loadFavs(p)
  pollEngine()
  setupMediaSession()
  // Back from the lock screen: wake the audio up if the browser paused it anyway.
  document.addEventListener('visibilitychange', onVisible)
  connectBooth()
  await reloadPads()
  lanIp.value = (await $fetch<string[]>('/api/lan').catch(() => []))[0] ?? null
  const frame = () => {
    now.value = Date.now()
    rafId = requestAnimationFrame(frame)
  }
  frame()
}

function onVisible() {
  if (document.visibilityState !== 'visible' || !listening.value || !audio) return
  void audio.resume()
  if (!lowLatencySupported()) audio.playThroughElement(true)
}

onMounted(start)
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible)
  stopListening()
  audio?.close()
  events?.close()
  clearTimeout(statusTimer)
  clearTimeout(engTimer)
  cancelAnimationFrame(rafId)
  for (const t of Object.values(holdTimers)) clearInterval(t)
  clearInterval(xyKeep)
  recEnd()
})
</script>

<template>
  <div class="shell">
    <header class="top">
      <div class="brand">
        <span class="moon" aria-hidden="true" />
        <span>Evening Mix</span>
      </div>
      <div class="conns">
        <div v-for="p in PLATFORMS" :key="p" class="conn" :class="[p, platformState(p).tone]">
          <span class="dot" />
          <div class="conn-text">
            <strong>{{ LABEL[p] }}</strong>
            <small :title="platformState(p).text">{{ platformState(p).text }}</small>
          </div>
          <button
            v-if="status?.[p]?.capture.state !== 'running'"
            class="ghost sm"
            :title="status?.[p]?.connected ? 'Re-capture credentials from a browser login' : 'Open a browser on the host to log in'"
            @click="connect(p)"
          >
            {{ status?.[p]?.connected && platformState(p).tone === 'ok' ? 'Login' : 'Connect' }}
          </button>
        </div>
      </div>
    </header>

    <p v-if="status && PLATFORMS.some((p) => status![p].capture.interactive && status![p].capture.state === 'running')" class="banner">
      A browser window opened on the machine running this app. Log in there and it closes by itself once the credentials are captured.
    </p>

    <nav class="tabs">
      <button :class="{ on: tab === 'favs' }" @click="tab = 'favs'">Search <span>{{ allFavs.length }}</span></button>
      <button :class="{ on: tab === 'evening' }" @click="tab = 'evening'">Evening <span>{{ evening.items.length }}</span></button>
      <button :class="{ on: tab === 'booth' }" @click="tab = 'booth'">Booth</button>
      <button :class="{ on: tab === 'requests' }" @click="tab = 'requests'">
        Requests <span v-if="pending.length" class="count-badge">{{ pending.length }}</span>
      </button>
    </nav>

    <main class="cols">
      <!-- ------------------------------------------------ search (favorites + catalogs) -->
      <section class="panel favs" :class="{ hidden: tab !== 'favs' }">
        <div class="panel-head">
          <h2>Search</h2>
          <div class="refresh">
            <button
              v-for="p in PLATFORMS"
              :key="p"
              class="ghost sm"
              :disabled="favLoading[p] || !status?.[p]?.connected"
              :title="`Last fetched ${ago(status?.[p]?.favorites?.fetchedAt)}`"
              @click="loadFavs(p, true)"
            >
              {{ favLoading[p] ? 'Loading…' : `↻ ${LABEL[p]}` }}
            </button>
          </div>
        </div>
        <p v-for="p in PLATFORMS" v-show="favErr[p]" :key="p" class="err">
          {{ LABEL[p] }}: {{ favErr[p] }}
          <button v-if="favErr[p] === 'Login required'" class="link" @click="connect(p)">Connect</button>
        </p>

        <div class="filters">
          <input v-model="q" type="search" placeholder="Search your favorites and all of SoundCloud and Deezer…" autocomplete="off">
          <div class="row">
            <select v-model="source" aria-label="Source">
              <option value="all">All sources</option>
              <option value="soundcloud">SoundCloud</option>
              <option value="deezer">Deezer</option>
            </select>
            <select v-model="kind" aria-label="Kind">
              <option value="all">Everything</option>
              <option value="track">Tracks</option>
              <option value="playlist">Playlists / sets</option>
              <option value="long">Long mixes (20 min+)</option>
            </select>
            <select v-model="sort" aria-label="Sort">
              <option value="added">Recently liked</option>
              <option value="title">Title</option>
              <option value="artist">Artist</option>
              <option value="duration">Longest</option>
            </select>
          </div>
          <small class="count">{{ filtered.length }} of {{ allFavs.length }} favorites</small>
        </div>

        <ul class="list">
          <li v-for="f in filtered.slice(0, shown)" :key="f.id" class="item">
            <button class="art" :title="`Play ${f.title} now`" @click="playNow(f)">
              <img v-if="f.artwork" :src="f.artwork" alt="" loading="lazy">
              <span class="play">▶</span>
            </button>
            <div class="meta">
              <div class="title">{{ f.title }}</div>
              <div class="sub">
                <span class="badge" :class="f.platform">{{ f.platform === 'soundcloud' ? 'SC' : 'DZ' }}</span>
                <span v-if="f.kind === 'playlist'" class="badge set">set · {{ f.trackCount }}</span>
                {{ f.artist }}
              </div>
            </div>
            <span class="dur">{{ dur(f.durationSec) }}</span>
            <button class="add" :disabled="inEvening.has(f.id)" :title="inEvening.has(f.id) ? 'In the evening' : 'Add to the evening'" @click="addToEvening(f)">
              {{ inEvening.has(f.id) ? '✓' : '+' }}
            </button>
          </li>
          <li v-if="!allFavs.length" class="empty">
            {{ PLATFORMS.some((p) => favLoading[p]) ? 'Loading favorites…' : 'Connect a platform to see your favorites.' }}
          </li>
        </ul>
        <button v-if="filtered.length > shown" class="ghost more" @click="shown += 300">
          Show more ({{ filtered.length - shown }} left)
        </button>
        <template v-if="q.trim().length >= 2 && (catalogShown.length || catalogLoading)">
          <h3 class="catalog-head">
            On {{ source === 'all' ? 'SoundCloud and Deezer' : LABEL[source] }}
            <small>{{ catalogLoading ? 'searching…' : 'not in your favorites' }}</small>
          </h3>
          <ul class="list">
          <li v-for="f in catalogShown" :key="f.id" class="item">
            <button class="art" :title="`Play ${f.title} now`" @click="playNow(f)">
              <img v-if="f.artwork" :src="f.artwork" alt="" loading="lazy">
              <span class="play">▶</span>
            </button>
            <div class="meta">
              <div class="title">{{ f.title }}</div>
              <div class="sub">
                <span class="badge" :class="f.platform">{{ f.platform === 'soundcloud' ? 'SC' : 'DZ' }}</span>
                <span v-if="f.kind === 'playlist'" class="badge set">set · {{ f.trackCount }}</span>
                {{ f.artist }}
              </div>
            </div>
            <span class="dur">{{ dur(f.durationSec) }}</span>
            <button class="add" :disabled="inEvening.has(f.id)" :title="inEvening.has(f.id) ? 'In the evening' : 'Add to the evening'" @click="addToEvening(f)">
              {{ inEvening.has(f.id) ? '✓' : '+' }}
            </button>
          </li>
          </ul>
        </template>
      </section>

      <!-- ------------------------------------------------ evening -->
      <section class="panel evening" :class="{ hidden: tab !== 'evening' }">
        <div class="pl-bar">
          <div class="pl-tabs" role="tablist" aria-label="Playlists">
            <button
              v-for="pl in doc.playlists"
              :key="pl.id"
              class="pl-tab"
              :class="{ on: pl.id === evening.id }"
              role="tab"
              :aria-selected="pl.id === evening.id"
              :title="`${pl.title} · ${pl.items.length} songs · ${dur(listSec(pl)) || '0:00'}`"
              @click="doc.open = pl.id"
            >
              <span v-if="eng?.currentId && pl.items.some((x) => x.id === eng!.currentId)" class="pl-live" title="Playing from this playlist">♪</span>
              <span class="pl-name">{{ pl.title || 'Untitled' }}</span>
            </button>
          </div>
          <button class="pl-new" title="New playlist" aria-label="New playlist" @click="newPlaylist">+</button>
        </div>
        <div class="panel-head">
          <input v-model="evening.title" class="ev-title" aria-label="Playlist title">
          <small class="saved">{{ saved ? 'Saved' : 'Saving…' }}</small>
          <button v-if="doc.playlists.length > 1" class="ghost sm" title="Delete this playlist" @click="deletePlaylist(evening)">🗑</button>
        </div>
        <form class="ai-row" @submit.prevent="askClaude">
          <input
            v-model="aiPrompt"
            class="ai-prompt"
            :disabled="aiBusy"
            placeholder="Ask Claude: calm bass music for ambience, go around Kebuffeule (Iorie remix)"
            aria-label="Ask Claude for songs"
            enterkeyhint="send"
            maxlength="300"
          >
          <input v-model.number="aiCount" class="ai-count" type="number" min="1" max="40" inputmode="numeric" aria-label="How many songs" title="How many songs">
          <button class="ai-go" type="submit" :disabled="aiBusy || !aiPrompt.trim()" :title="aiBusy ? 'Claude is choosing…' : 'Add songs'">{{ aiBusy ? '⏳' : '✨' }}</button>
        </form>
        <div class="ai-meta">
          <div class="ai-methods" role="group" aria-label="Method">
            <button v-for="m in MIX_METHODS" :key="m.id" type="button" :class="{ on: aiMethod === m.id }" :title="m.title" @click="aiMethod = m.id">{{ m.label }}</button>
          </div>
          <small v-if="aiStatus" class="ai-status" :class="{ busy: aiBusy }">{{ aiStatus }}</small>
        </div>
        <div class="ev-meta">
          <label>Starts <input v-model="evening.startTime" type="time"></label>
          <span>{{ dur(totalSec) }} · ends ~{{ endClock }}</span>
        </div>

        <div v-if="totalSec" class="arc" aria-label="Mood arc over the evening">
          <span
            v-for="(it, i) in evening.items"
            :key="it.id"
            :class="`m-${it.mood || 'none'}`"
            :style="{ flexGrow: Math.max(it.durationSec, 60) }"
            :title="`${clock(schedule[i])} ${it.title}`"
          />
        </div>

        <ol class="list ev-list">
          <li
            v-for="(it, i) in evening.items"
            :key="it.id"
            class="item ev"
            :class="{ dragging: dragFrom === i, current: eng?.currentId === it.id }"
            draggable="true"
            @dragstart="dragFrom = i"
            @dragover.prevent
            @drop="onDrop(i)"
            :data-i="i"
          >
            <span
              class="handle"
              title="Drag to reorder"
              @pointerdown="handleDown($event, i)"
              @pointermove="handleMove"
              @pointerup="handleUp"
              @pointercancel="handleUp"
            >⠿</span>
            <span class="time">{{ clock(schedule[i]) }}</span>
            <button class="art" :title="`Play from ${it.title}`" @click="playNow(it)">
              <img v-if="it.artwork" :src="it.artwork" alt="" loading="lazy">
              <span class="play">▶</span>
            </button>
            <div class="meta">
              <div class="title">{{ it.title }}</div>
              <div class="sub">
                <span class="badge" :class="it.platform">{{ it.platform === 'soundcloud' ? 'SC' : 'DZ' }}</span>
                {{ it.artist }} · {{ dur(it.durationSec) }}
                <span v-if="it.requestedBy" class="badge req">🙋 {{ it.requestedBy }}</span>
              </div>
              <div class="moods">
                <button
                  v-for="m in MOODS"
                  :key="m.id"
                  class="mood"
                  :class="[`m-${m.id}`, { on: it.mood === m.id }]"
                  @click="it.mood = m.id"
                >
                  {{ m.label }}
                </button>
              </div>
            </div>
            <div class="ops">
              <button class="ghost sm" title="Move up" :disabled="i === 0" @click="move(i, -1)">↑</button>
              <button class="ghost sm" title="Move down" :disabled="i === evening.items.length - 1" @click="move(i, 1)">↓</button>
              <button class="ghost sm" title="Remove" @click="removeAt(i)">✕</button>
            </div>
          </li>
          <li v-if="!evening.items.length" class="empty">Add favorites with + and arrange them here.</li>
        </ol>
      </section>
      <!-- ------------------------------------------------ booth -->
      <aside class="side" :class="{ hidden: tab !== 'booth' && tab !== 'requests' }">
        <section class="panel booth" :class="{ hidden: tab !== 'booth' }">
          <div class="panel-head">
            <h2>Booth</h2>
            <button class="ghost sm" :disabled="!booth.pads.length" @click="stopPads">Stop pads</button>
          </div>
          <p v-if="fxError" class="err">{{ fxError }}</p>

          <div class="pads">
            <div v-for="p in pads" :key="p.id" class="pad-wrap">
              <button
                class="pad"
                :class="{ live: booth.pads.includes(p.id) }"
                :title="`${p.label} (${p.durationSec?.toFixed(1)} s)`"
                @pointerdown="padDown($event, p)"
                @pointermove="padMove"
                @pointerup="padUp($event, p)"
                @pointercancel="padTouches.delete($event.pointerId)"
                @contextmenu.prevent
              >
                <span class="pad-emoji">{{ p.emoji }}</span>
                <span class="pad-label">{{ p.label }}</span>
              </button>
              <button v-if="p.recorded" class="pad-del" :title="`Delete ${p.label}`" :aria-label="`Delete ${p.label}`" @click="deletePad(p)">✕</button>
            </div>
            <button
              class="pad rec"
              :class="{ live: recording }"
              title="Hold and speak (4 s max): it becomes a pad"
              @pointerdown="recStart"
              @pointerup="recEnd"
              @pointercancel="recEnd"
              @contextmenu.prevent
            >
              <span class="pad-emoji">{{ recording ? '⏺️' : '🔴' }}</span>
              <span class="pad-label">{{ recording ? 'Recording…' : 'Hold to record' }}</span>
            </button>
          </div>
          <label class="slider-row">
            <span>Pads volume</span>
            <input type="range" min="0" max="1.5" step="0.05" :value="booth.padVolume" @change="setFxValue('padVolume', Number(($event.target as HTMLInputElement).value))">
          </label>

          <div class="holds">
            <button
              class="hold"
              :class="{ on: held.talkover || booth.talkover }"
              title="Hold: the music drops and your voice (this device's mic) plays with reverb"
              @pointerdown.prevent="holdStart('talkover', $event)"
              @pointerup="holdEnd('talkover')"
              @pointercancel="holdEnd('talkover')"
              @contextmenu.prevent
            >
              🎙️ <span>Talkover</span><small>hold</small>
            </button>
            <button
              class="hold"
              :class="{ on: held.echo || booth.echo }"
              title="Hold: send an echo into the current track"
              @pointerdown.prevent="holdStart('echo', $event)"
              @pointerup="holdEnd('echo')"
              @pointercancel="holdEnd('echo')"
              @contextmenu.prevent
            >
              🌀 <span>Echo</span><small>hold</small>
            </button>
            <button class="hold" title="Echo the current track out and bring in the next one" :disabled="eng?.status !== 'playing'" @click="echoOut">
              🌀⏭ <span>Echo out</span><small>tap</small>
            </button>
            <button
              class="hold"
              :class="{ on: held.brake || booth.brake }"
              title="Hold: the music slows down to a stop like a turntable; let go to spin it back up"
              @pointerdown.prevent="holdStart('brake', $event)"
              @pointerup="holdEnd('brake')"
              @pointercancel="holdEnd('brake')"
              @contextmenu.prevent
            >
              🛑 <span>Brake</span><small>hold</small>
            </button>
          </div>

          <div
            class="xy"
            :class="{ on: !!xyShown }"
            title="Drag: left = low-pass, right = high-pass, up = resonance + echo. Let go to come back."
            @pointerdown="xyDown"
            @pointermove="xyMove"
            @pointerup="xyUp"
            @pointercancel="xyUp"
            @contextmenu.prevent
          >
            <span class="xy-l">◀ low</span>
            <span class="xy-r">high ▶</span>
            <span class="xy-t">▲ resonance + echo</span>
            <span v-if="xyShown" class="xy-dot" :style="{ left: `${xyShown.x * 100}%`, top: `${(1 - xyShown.y) * 100}%` }" />
          </div>

          <label class="slider-row">
            <span>Voice volume</span>
            <input type="range" min="0" max="2" step="0.05" :value="voiceVolume" @change="setVoiceVolume(Number(($event.target as HTMLInputElement).value))">
          </label>
          <div class="seg voice-seg" role="group" aria-label="Voice">
            <button v-for="v in VOICES" :key="v.id" :class="{ on: voicePreset === v.id }" @click="setVoicePreset(v.id)">{{ v.label }}</button>
          </div>

          <h3>Colour</h3>
          <div class="seg">
            <button v-for="c in COLORS" :key="c.id" :class="{ on: booth.color === c.id }" @click="setColor(c.id)">
              {{ c.emoji }} {{ c.label }}
            </button>
          </div>

          <h3>
            EQ <small>(master)</small>
            <button class="link" @click="resetEq">reset</button>
          </h3>
          <div class="eq">
            <label v-for="b in EQ_BANDS" :key="b.id">
              <span class="eq-name">{{ b.label }}</span>
              <input
                type="range" min="-26" max="6" step="1"
                :value="booth.eq[b.id]"
                @input="setEq(b.id, Number(($event.target as HTMLInputElement).value))"
                @dblclick="setEq(b.id, 0)"
              >
              <span class="eq-val" :class="{ kill: booth.eq[b.id] <= -26 }">{{ eqLabel(booth.eq[b.id]) }}</span>
            </label>
          </div>

          <h3>Transitions & safety</h3>
          <div v-if="eng" class="settings">
            <label class="check">
              <input type="checkbox" :checked="eng.settings.bassSwap" @change="setSetting('bassSwap', ($event.target as HTMLInputElement).checked)">
              Bass swap during crossfades
            </label>
            <label class="slider-row">
              <span>Talkover / pad duck: −{{ booth.duckDb }} dB</span>
              <input type="range" min="3" max="24" step="1" :value="booth.duckDb" @change="setFxValue('duck', Number(($event.target as HTMLInputElement).value))">
            </label>
            <label class="slider-row">
              <span>Auto-pause after {{ eng.settings.autoPauseHours ? `${eng.settings.autoPauseHours} h` : 'never' }}</span>
              <input type="range" min="0" max="12" step="1" :value="eng.settings.autoPauseHours" @input="setSetting('autoPauseHours', Number(($event.target as HTMLInputElement).value))">
            </label>
            <label class="slider-row">
              <span>Pause when nobody listens for {{ eng.settings.idlePauseMin ? `${eng.settings.idlePauseMin} min` : 'never' }}</span>
              <input type="range" min="0" max="60" step="5" :value="eng.settings.idlePauseMin" @input="setSetting('idlePauseMin', Number(($event.target as HTMLInputElement).value))">
            </label>
          </div>
        </section>

        <!-- ------------------------------------------------ requests -->
        <section class="panel requests" :class="{ hidden: tab !== 'requests' }">
          <div class="panel-head">
            <h2>Guest requests <span v-if="pending.length" class="count-badge">{{ pending.length }}</span></h2>
          </div>
          <p class="muted small">Guests open <strong>{{ guestUrl }}</strong> to search your favorites (or all of Deezer), request and vote.</p>
          <ul class="list">
            <li v-for="r in pending" :key="r.id" class="item">
              <img v-if="r.item.artwork" class="thumb" :src="r.item.artwork" alt="">
              <div class="meta">
                <div class="title">{{ r.item.title }}</div>
                <div class="sub">
                  <span class="badge" :class="r.item.platform">{{ r.item.platform === 'soundcloud' ? 'SC' : 'DZ' }}</span>
                  {{ r.item.artist }} · 🙋 {{ r.guestName }}
                </div>
              </div>
              <span class="votes" :title="`${r.votes} vote(s)`">👍 {{ r.votes }}</span>
              <button class="ghost sm ok-btn" title="Approve: plays after the current track" @click="decideRequest(r, 'approve')">✓</button>
              <button class="ghost sm" title="Reject" @click="decideRequest(r, 'reject')">✕</button>
            </li>
            <li v-if="!pending.length" class="empty">No pending requests.</li>
          </ul>
          <template v-if="decided.length">
            <h3>Recent</h3>
            <ul class="list dim">
              <li v-for="r in decided" :key="r.id" class="item">
                <div class="meta">
                  <div class="title">{{ r.item.title }}</div>
                  <div class="sub">{{ r.status === 'approved' ? '✓ approved' : '✕ rejected' }} · 🙋 {{ r.guestName }} · 👍 {{ r.votes }}</div>
                </div>
              </li>
            </ul>
          </template>
        </section>
      </aside>
    </main>

    <!-- ------------------------------------------------ remote -->
    <footer class="remote">
      <audio
        ref="audioEl"
        preload="none"
        @playing="audioState = 'on'"
        @error="onAudioTrouble"
        @ended="onAudioTrouble"
      />
      <div
        class="progress"
        :class="{ seekable: eng?.current && eng.durSec }"
        role="slider"
        aria-label="Position"
        :aria-valuenow="Math.round(shownPos)"
        :aria-valuemax="Math.round(eng?.durSec || 0)"
        @click="onSeek"
      >
        <span :style="{ width: `${eng?.durSec ? (shownPos / eng.durSec) * 100 : 0}%` }" />
      </div>
      <div class="remote-row">
        <div class="now">
          <template v-if="eng?.current">
            <img v-if="eng.current.artwork" :src="eng.current.artwork" alt="">
            <div class="now-text">
              <div class="title">
                <span class="badge" :class="eng.current.platform">{{ eng.current.platform === 'soundcloud' ? 'SC' : 'DZ' }}</span>
                {{ eng.current.title }}
              </div>
              <div class="sub">
                {{ eng.current.artist }} · {{ dur(Math.floor(shownPos)) }} / {{ dur(Math.round(eng.durSec)) }}
                <span v-if="eng.fading" class="fading">crossfading…</span>
                <span v-else-if="eng.next"> · next: {{ eng.next.title }}</span>
              </div>
            </div>
          </template>
          <div v-else class="sub idle">
            {{ evening.items.length ? 'Ready. Press play to start the evening.' : 'Add favorites to the evening, then press play.' }}
          </div>
        </div>

        <div class="transport">
          <button class="ghost round" title="Previous" :disabled="busy || !eng?.current" @click="command('prev')">⏮</button>
          <button class="primary round" :title="eng?.status === 'playing' ? 'Pause' : 'Play'" :disabled="busy && eng?.status !== 'playing'" @click="togglePlay">
            {{ eng?.status === 'playing' ? '❚❚' : '▶' }}
          </button>
          <button class="ghost round" title="Next" :disabled="busy || !eng?.next" @click="command('next')">⏭</button>
        </div>

        <div class="extras">
          <label class="xfade" title="Crossfade length between items">
            <span>Fade {{ eng?.crossfade ?? 6 }}s</span>
            <input
              type="range" min="0" max="12" step="1"
              :value="eng?.crossfade ?? 6"
              @input="onCrossfade(Number(($event.target as HTMLInputElement).value))"
            >
          </label>
          <button
            class="listen"
            :class="audioState"
            :title="listening ? `Stop listening on this device (${syncLabel}${lag != null ? `, ${lag.toFixed(1)} s behind the server` : ''})` : 'Play the evening on this device, in sync with the other listening devices'"
            @click="listening ? stopListening() : startListening()"
          >
            {{ audioState === 'on' ? '🔊 Listening' : audioState === 'connecting' ? '… Connecting' : '🎧 Listen here' }}
          </button>
          <label
            v-if="listening"
            class="xfade ahead"
            title="Play this device earlier, to catch up with the others when its speaker adds delay (Bluetooth: often 100–300 ms). Drag until the speakers sound as one."
          >
            <span>{{ ahead > 0 ? 'Ahead' : ahead < 0 ? 'Behind' : 'Sync' }} {{ Math.round(Math.abs(ahead) * 1000) }} ms<small v-if="syncLabel"> · {{ syncLabel }}</small></span>
            <input
              type="range" min="-0.2" max="0.5" step="0.005"
              :value="ahead"
              @input="setAhead(Number(($event.target as HTMLInputElement).value))"
              @dblclick="setAhead(0)"
            >
          </label>
        </div>
      </div>
      <p v-if="eng?.error" class="err remote-err">{{ eng.error }}</p>
      <p v-else-if="eng?.notice" class="muted remote-err">{{ eng.notice }}</p>
    </footer>
  </div>
</template>
