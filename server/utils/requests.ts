import { randomUUID } from 'node:crypto'
import { engine } from './engine'
import { deezerTrack, searchCatalogs, soundcloudTrack } from './platforms'
import { activeList, favsFile, PLATFORMS, readJson, updateEvening, writeJson, type FavCache, type FavItem } from './store'

export interface GuestRequest {
  id: string
  item: FavItem
  guestId: string
  guestName: string
  votes: string[] // guest ids, requester included
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  decidedAt?: string
}

const FILE = 'requests.json'
const MAX_PENDING_PER_GUEST = 5

let lock: Promise<unknown> = Promise.resolve()
function withRequests<T>(fn: (list: GuestRequest[]) => Promise<T> | T): Promise<T> {
  const p = lock.then(async () => {
    const list = await readJson<GuestRequest[]>(FILE, [])
    const r = await fn(list)
    await writeJson(FILE, list.slice(-500))
    return r
  })
  lock = p.catch(() => {})
  return p
}

export const listRequests = () => readJson<GuestRequest[]>(FILE, [])

// --------------------------------------------------------------- favorites

let favIndex: { at: number; items: FavItem[] } | null = null
export async function allFavorites(): Promise<FavItem[]> {
  if (favIndex && Date.now() - favIndex.at < 60_000) return favIndex.items
  const lists = await Promise.all(PLATFORMS.map((p) => readJson<FavCache | null>(favsFile(p), null)))
  favIndex = { at: Date.now(), items: lists.flatMap((l) => l?.items ?? []) }
  return favIndex.items
}

const dedupeKey = (f: FavItem) => `${f.title}|${f.artist}`.toLowerCase().replace(/[^\p{L}\p{N}|]+/gu, '')

/**
 * Guest search: matching favorites first, then the rest of the SoundCloud and Deezer catalogs.
 * The same song often exists several times (reuploads, both platforms): show it once.
 */
export async function searchFavorites(q: string, limit = 40) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  const all = await allFavorites()
  const hits = terms.length
    ? all.filter((f) => {
        const hay = `${f.title} ${f.artist} ${f.genre ?? ''}`.toLowerCase()
        return terms.every((t) => hay.includes(t))
      })
    : all
  const catalog = terms.length ? (await searchCatalogs(q)).filter((f) => f.kind === 'track') : [] // sets can't be requested
  const favIds = new Set(all.map((f) => f.id))
  const seen = new Set<string>()
  const out: ReturnType<typeof publicItem>[] = []
  for (const f of [...hits.slice(0, limit), ...catalog]) {
    const key = dedupeKey(f)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...publicItem(f), fav: favIds.has(f.id) })
  }
  return out
}

export const publicItem = (f: FavItem) => ({
  id: f.id,
  title: f.title,
  artist: f.artist,
  artwork: f.artwork,
  platform: f.platform,
  kind: f.kind,
  durationSec: f.durationSec,
})

// ----------------------------------------------------------------- guests

/** A guest asks for a track; asking again for an already-requested one counts as a vote. */
export async function requestTrack(guestId: string, guestName: string, itemId: string) {
  const dz = /^deezer:track:(\d+)$/.exec(itemId)
  const sc = /^soundcloud:track:(\d+)$/.exec(itemId)
  const item = (await allFavorites()).find((f) => f.id === itemId)
    ?? (dz ? await deezerTrack(dz[1]!) : sc ? await soundcloudTrack(sc[1]!).catch(() => null) : null)
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Track not found' })
  return withRequests((list) => {
    const existing = list.find((r) => r.item.id === itemId && r.status !== 'rejected')
    if (existing) {
      if (!existing.votes.includes(guestId)) existing.votes.push(guestId)
      return existing
    }
    const mine = list.filter((r) => r.guestId === guestId && r.status === 'pending').length
    if (mine >= MAX_PENDING_PER_GUEST) {
      throw createError({ statusCode: 429, statusMessage: `Max ${MAX_PENDING_PER_GUEST} pending requests per guest` })
    }
    const r: GuestRequest = {
      id: randomUUID(),
      item,
      guestId,
      guestName: guestName.trim().slice(0, 40) || 'A guest',
      votes: [guestId],
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    list.push(r)
    return r
  })
}

export function toggleVote(guestId: string, requestId: string) {
  return withRequests((list) => {
    const r = list.find((x) => x.id === requestId)
    if (!r || r.status === 'rejected') throw createError({ statusCode: 404 })
    r.votes = r.votes.includes(guestId) ? r.votes.filter((v) => v !== guestId) : [...r.votes, guestId]
    return r
  })
}

export async function guestView(guestId: string) {
  const list = await listRequests()
  const dayAgo = Date.now() - 12 * 3600_000
  return list
    .filter((r) => r.status !== 'rejected' && Date.parse(r.createdAt) > dayAgo)
    .sort((a, b) => (a.status === b.status ? b.votes.length - a.votes.length : a.status === 'pending' ? -1 : 1))
    .slice(0, 60)
    .map((r) => ({
      id: r.id,
      item: publicItem(r.item),
      guestName: r.guestName,
      votes: r.votes.length,
      voted: r.votes.includes(guestId),
      mine: r.guestId === guestId,
      status: r.status,
    }))
}

// ------------------------------------------------------------------ host

/**
 * Approve: insert the track right after what's playing, behind earlier approved
 * requests that haven't played yet (first come, first served).
 */
export function decide(requestId: string, action: 'approve' | 'reject') {
  return withRequests(async (list) => {
    const r = list.find((x) => x.id === requestId)
    if (!r) throw createError({ statusCode: 404 })
    if (r.status !== 'pending') return r
    r.status = action === 'approve' ? 'approved' : 'rejected'
    r.decidedAt = new Date().toISOString()
    if (action === 'approve') {
      await updateEvening((doc) => {
        const ev = activeList(doc, engine.currentId)
        if (ev.items.some((i) => i.id === r.item.id)) return
        const cur = engine.currentId ? ev.items.findIndex((i) => i.id === engine.currentId) : -1
        let pos = cur < 0 ? ev.items.length : cur + 1
        while (cur >= 0 && ev.items[pos]?.requestedBy) pos++
        ev.items.splice(pos, 0, { ...r.item, requestedBy: r.guestName })
      })
    }
    return r
  })
}
