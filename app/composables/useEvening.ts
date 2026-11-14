import type { Evening, FavItem, Playlist } from '#shared/types/music'

/**
 * The evening: all playlists, the open one (being edited, where new songs land), and
 * saving. Saved 600 ms after the last change; changes made elsewhere (another player, an
 * approved guest request) are picked up through the engine's `eveningRev`.
 */
export const useEvening = defineSingleton(() => {
  const doc = ref<Evening>({ playlists: [{ id: 'main', title: 'Chill & feels', startTime: '20:00', items: [] }], open: 'main', rev: 0 })
  const evening = computed(() => doc.value.playlists.find((p) => p.id === doc.value.open) ?? doc.value.playlists[0]!)
  const inEvening = computed(() => new Set(evening.value.items.map((i) => i.id)))
  const saved = ref(true)
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  // Changes that come from the server must not be saved back, or two open players would
  // bounce the list between them forever.
  let applyingRemote = false
  function applyEvening(e: Evening) {
    applyingRemote = true
    doc.value = e
    nextTick(() => (applyingRemote = false))
  }
  const reload = async () => applyEvening(await $fetch<Evening>('/api/evening'))

  watch(
    doc,
    () => {
      if (applyingRemote) return
      saved.value = false
      clearTimeout(saveTimer)
      saveTimer = setTimeout(save, 600)
    },
    { deep: true },
  )

  async function save() {
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

  /** The server's revision changed: reload, unless we have unsaved edits (ours win). */
  async function sync(serverRev?: number) {
    if (serverRev === undefined || serverRev === doc.value.rev || saveTimer || !saved.value) return
    await reload()
  }

  // ------------------------------------------------------------- playlists
  function newPlaylist() {
    const id = `pl-${Date.now().toString(36)}`
    doc.value.playlists.push({ id, title: `Playlist ${doc.value.playlists.length + 1}`, startTime: evening.value.startTime, items: [] })
    doc.value.open = id
  }
  function deletePlaylist(p: Playlist) {
    if (doc.value.playlists.length < 2) return
    const i = doc.value.playlists.indexOf(p)
    doc.value.playlists.splice(i, 1)
    doc.value.open = doc.value.playlists[Math.max(0, i - 1)]!.id
  }
  const playlistSec = (p: Playlist) => p.items.reduce((s, i) => s + (i.durationSec || 0), 0)

  // ----------------------------------------------------------------- items
  function add(f: FavItem) {
    if (inEvening.value.has(f.id)) return
    evening.value.items.push({ ...f })
  }
  /** Append to a given playlist (it may no longer be the open one), skipping songs it has. */
  function append(playlistId: string, items: FavItem[]) {
    const pl = doc.value.playlists.find((p) => p.id === playlistId) ?? evening.value
    const have = new Set(pl.items.map((i) => i.id))
    const added = items.filter((f) => !have.has(f.id))
    pl.items.push(...added)
    return added.length
  }
  /**
   * Lay out a playlist's songs from `from` on as Claude arranged them (existing songs by index,
   * new ones by index in `added`). Only if the playlist still holds exactly `ids` (nothing changed
   * while Claude was thinking); otherwise just append the new songs. Returns how many were added.
   */
  function arrange(playlistId: string, ids: string[], from: number, slots: ({ cur: number } | { add: number })[], added: FavItem[]) {
    const pl = doc.value.playlists.find((p) => p.id === playlistId)
    const same = pl && pl.items.length >= ids.length && ids.every((id, i) => pl.items[i]!.id === id)
    if (!same) return { added: append(playlistId, added), arranged: false }
    const have = new Set(pl.items.map((i) => i.id))
    const fresh = new Set<string>()
    const tail = slots.flatMap((s) => {
      if ('cur' in s) return pl.items[s.cur] ? [pl.items[s.cur]!] : []
      const f = added[s.add]
      if (!f || have.has(f.id) || fresh.has(f.id)) return []
      fresh.add(f.id)
      return [{ ...f }]
    })
    // Songs beyond what Claude was shown keep their place at the end.
    pl.items.splice(from, ids.length - from, ...tail)
    return { added: fresh.size, arranged: true }
  }
  function removeAt(i: number) {
    evening.value.items.splice(i, 1)
  }
  function moveTo(from: number, to: number) {
    const items = evening.value.items
    if (from === to || to < 0 || to >= items.length) return
    const [it] = items.splice(from, 1)
    items.splice(to, 0, it!)
  }
  function swap(i: number, d: number) {
    const j = i + d
    const items = evening.value.items
    if (j < 0 || j >= items.length) return
    ;[items[i], items[j]] = [items[j]!, items[i]!]
  }

  /** Start time of each item, in seconds since midnight. */
  const schedule = computed(() => {
    let t = parseClock(evening.value.startTime)
    return evening.value.items.map((it) => {
      const start = t
      t += it.durationSec
      return start
    })
  })
  const totalSec = computed(() => evening.value.items.reduce((s, i) => s + i.durationSec, 0))
  const endClock = computed(() => formatClock(parseClock(evening.value.startTime) + totalSec.value))

  return {
    doc, evening, inEvening, saved, applyEvening, reload, sync,
    newPlaylist, deletePlaylist, playlistSec,
    add, append, arrange, removeAt, moveTo, swap, schedule, totalSec, endClock,
  }
})
