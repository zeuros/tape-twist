import type { FavItem, Platform } from '#shared/types/music'

const PAGE = 150

/**
 * The Search panel: filter and sort the favorites, and search the whole SoundCloud and
 * Deezer catalogs for the same words (shown under the favorites).
 */
export function useFavoriteSearch() {
  const { allFavs } = usePlatforms()
  const q = ref('')
  const source = ref<'all' | Platform>('all')
  const kind = ref<'all' | 'track' | 'playlist' | 'long'>('all')
  const sort = ref<'added' | 'title' | 'artist' | 'duration'>('added')
  const shown = ref(PAGE)

  const matchesFilters = (f: FavItem) => {
    if (source.value !== 'all' && f.platform !== source.value) return false
    if (kind.value === 'long' && f.durationSec < 20 * 60) return false
    if ((kind.value === 'track' || kind.value === 'playlist') && f.kind !== kind.value) return false
    return true
  }

  const filtered = computed(() => {
    const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean)
    const list = allFavs.value.filter((f) => {
      if (!matchesFilters(f)) return false
      if (!terms.length) return true
      const hay = `${f.title} ${f.artist} ${f.genre ?? ''}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
    const by = sort.value
    return list.sort((a, b) =>
      by === 'title' ? a.title.localeCompare(b.title)
      : by === 'artist' ? a.artist.localeCompare(b.artist)
      : by === 'duration' ? b.durationSec - a.durationSec
      : (b.addedAt ?? '').localeCompare(a.addedAt ?? ''),
    )
  })
  watch([q, source, kind, sort], () => (shown.value = PAGE))

  // Beyond the favorites: the whole catalogs (debounced).
  const catalog = ref<FavItem[]>([])
  const catalogLoading = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const favIds = computed(() => new Set(allFavs.value.map((f) => f.id)))
  const catalogShown = computed(() => catalog.value.filter((f) => !favIds.value.has(f.id) && matchesFilters(f)))
  watch(q, (v) => {
    clearTimeout(timer)
    const query = v.trim()
    if (query.length < 2) {
      catalog.value = []
      catalogLoading.value = false
      return
    }
    catalogLoading.value = true
    timer = setTimeout(async () => {
      const r = await $fetch<FavItem[]>('/api/search', { query: { q: query } }).catch(() => [])
      if (q.value.trim() === query) {
        catalog.value = r
        catalogLoading.value = false
      }
    }, 350)
  })
  onBeforeUnmount(() => clearTimeout(timer))

  return { q, source, kind, sort, shown, filtered, catalogShown, catalogLoading }
}
