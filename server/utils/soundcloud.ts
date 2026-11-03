import type { FavItem } from '#shared/types/music'
import { AuthFailed, cookieHeader, withCreds } from './platformAuth'
import { saveCreds, type Credentials } from './store'

/** SoundCloud web API (api-v2), with the captured OAuth token and client_id. */

const SC_API = 'https://api-v2.soundcloud.com'

async function scFetch(c: Credentials, pathOrUrl: string) {
  const url = new URL(pathOrUrl, SC_API)
  url.searchParams.set('client_id', c.clientId!)
  const res = await fetch(url, {
    headers: {
      ...c.headers,
      accept: 'application/json, text/javascript, */*; q=0.01',
      authorization: `OAuth ${c.oauthToken}`,
      cookie: cookieHeader(c.cookies),
      origin: 'https://soundcloud.com',
      referer: 'https://soundcloud.com/',
    },
  })
  if (res.status === 401 || res.status === 403) throw new AuthFailed()
  if (!res.ok) throw new Error(`SoundCloud ${res.status} on ${url.pathname}`)
  return res.json() as Promise<any>
}

async function scMe(c: Credentials) {
  const me = await scFetch(c, '/me')
  if (c.userId !== String(me.id)) {
    c.userId = String(me.id)
    c.username = me.username
    await saveCreds('soundcloud', c)
  }
  return me
}

async function scPaged(c: Credentials, path: string, max = 5000) {
  const out: any[] = []
  let next: string | null = `${path}${path.includes('?') ? '&' : '?'}limit=200&linked_partitioning=1`
  while (next && out.length < max) {
    const page: any = await scFetch(c, next)
    out.push(...(page.collection ?? []))
    next = page.next_href || null
  }
  return out
}

const scArt = (u?: string | null) => u?.replace('-large.', '-t200x200.') || undefined

function scTrack(t: any, addedAt?: string): FavItem {
  return {
    id: `soundcloud:track:${t.id}`,
    platform: 'soundcloud',
    kind: 'track',
    nativeId: String(t.id),
    title: t.title,
    artist: t.user?.username ?? '',
    durationSec: Math.round((t.full_duration || t.duration || 0) / 1000),
    url: t.permalink_url,
    artwork: scArt(t.artwork_url || t.user?.avatar_url),
    embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(`https://api.soundcloud.com/tracks/${t.id}`)}&auto_play=true&visual=false&hide_related=true&show_comments=false`,
    genre: t.genre || undefined,
    addedAt,
  }
}

function scPlaylist(pl: any, addedAt?: string): FavItem {
  return {
    id: `soundcloud:playlist:${pl.id}`,
    platform: 'soundcloud',
    kind: 'playlist',
    nativeId: String(pl.id),
    title: pl.title,
    artist: pl.user?.username ?? '',
    durationSec: Math.round((pl.duration || 0) / 1000),
    url: pl.permalink_url,
    artwork: scArt(pl.artwork_url || pl.user?.avatar_url),
    embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(`https://api.soundcloud.com/playlists/${pl.id}`)}&auto_play=true&visual=false&hide_related=true&show_comments=false`,
    genre: pl.genre || undefined,
    addedAt,
    trackCount: pl.track_count,
  }
}

export async function soundcloudFavorites(): Promise<FavItem[]> {
  return withCreds('soundcloud', async (c) => {
    if (!c.clientId || !c.oauthToken) throw new AuthFailed()
    const me = await scMe(c)
    const [likes, plLikes] = await Promise.all([
      scPaged(c, `/users/${me.id}/track_likes`),
      scPaged(c, `/users/${me.id}/playlist_likes`).catch(() => []),
    ])
    return [
      ...likes.filter((l) => l.track).map((l) => scTrack(l.track, l.created_at)),
      ...plLikes.filter((l) => l.playlist).map((l) => scPlaylist(l.playlist, l.created_at)),
    ]
  })
}

/** Search the whole SoundCloud catalog (tracks and sets), like the search box on soundcloud.com. */
const scSearchCache = new Map<string, { at: number; items: FavItem[] }>()
export async function searchSoundcloud(query: string, nb = 30): Promise<FavItem[]> {
  const key = query.trim().toLowerCase()
  if (key.length < 2) return []
  const hit = scSearchCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.items
  const items = await withCreds('soundcloud', async (c) => {
    if (!c.clientId || !c.oauthToken) throw new AuthFailed()
    const q = encodeURIComponent(query.trim())
    const [tracks, sets] = await Promise.all([
      scFetch(c, `/search/tracks?q=${q}&limit=${nb}`),
      scFetch(c, `/search/playlists_without_albums?q=${q}&limit=${Math.ceil(nb / 4)}`).catch(() => ({ collection: [] })),
    ])
    return [
      ...((tracks?.collection ?? []) as any[]).map((t) => scTrack(t)),
      ...((sets?.collection ?? []) as any[]).map((pl) => scPlaylist(pl)),
    ]
  })
  if (scSearchCache.size > 300) scSearchCache.clear()
  scSearchCache.set(key, { at: Date.now(), items })
  return items
}

/** Look up one SoundCloud track by its native ID (for requests of non-favorites). */
export async function soundcloudTrack(nativeId: string): Promise<FavItem | null> {
  if (!/^\d+$/.test(nativeId)) return null
  for (const { items } of scSearchCache.values()) {
    const f = items.find((i) => i.kind === 'track' && i.nativeId === nativeId)
    if (f) return f
  }
  return withCreds('soundcloud', async (c) => {
    const t = await scFetch(c, `/tracks/${nativeId}`).catch(() => null)
    return t?.id ? scTrack(t) : null
  })
}

/** SoundCloud's "related tracks" for a track (what its station would play next). */
export async function soundcloudRelated(nativeId: string, nb = 30): Promise<FavItem[]> {
  if (!/^\d+$/.test(nativeId)) return []
  return withCreds('soundcloud', async (c) => {
    const r = await scFetch(c, `/tracks/${nativeId}/related?limit=${nb}`).catch(() => null)
    return ((r?.collection ?? []) as any[]).map((t) => scTrack(t))
  })
}

/** The logged-in user's name (checks that the session works). */
export async function soundcloudUsername(c: Credentials): Promise<string> {
  if (!c.clientId || !c.oauthToken) throw new AuthFailed()
  return (await scMe(c)).username
}
