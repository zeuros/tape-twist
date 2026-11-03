import { capture } from './capture'
import { loadCreds, saveCreds, type Credentials, type FavItem, type Platform } from './store'

export class NeedsLogin extends Error {
  constructor(public platform: Platform, reason: string) {
    super(`${platform}: ${reason}`)
  }
}

const cookieHeader = (c: Record<string, string>) =>
  Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ')

/** Merge Set-Cookie values into stored cookies, like a browser would. */
function absorbCookies(creds: Credentials, res: Response) {
  const list = res.headers.getSetCookie?.() ?? []
  let changed = false
  for (const line of list) {
    const [pair] = line.split(';')
    const i = pair.indexOf('=')
    if (i <= 0) continue
    const k = pair.slice(0, i).trim()
    const v = pair.slice(i + 1).trim()
    if (creds.cookies[k] !== v) {
      creds.cookies[k] = v
      changed = true
    }
  }
  return changed
}

/**
 * Get usable credentials: stored ones, or a silent headless refresh from the saved
 * browser profile. Throws NeedsLogin when a real login is required.
 */
async function getCreds(p: Platform, forceRefresh = false): Promise<Credentials> {
  let c = forceRefresh ? null : await loadCreds(p)
  if (!c) c = await capture(p, false)
  if (!c) throw new NeedsLogin(p, 'not connected or session expired')
  return c
}

/** Run fn with credentials; on an auth failure, refresh silently once and retry. */
async function withCreds<T>(p: Platform, fn: (c: Credentials) => Promise<T>): Promise<T> {
  try {
    return await fn(await getCreds(p))
  } catch (e) {
    if (!(e instanceof AuthFailed)) throw e
  }
  return fn(await getCreds(p, true)).catch((e) => {
    if (e instanceof AuthFailed) throw new NeedsLogin(p, 'session expired, log in again')
    throw e
  })
}

class AuthFailed extends Error {}

// ---------------------------------------------------------------- SoundCloud

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

async function soundcloudFavorites(): Promise<FavItem[]> {
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

// -------------------------------------------------------------------- Deezer

const DZ_GW = 'https://www.deezer.com/ajax/gw-light.php'
let dzApiToken: string | null = null

async function dzCall(c: Credentials, method: string, params: unknown = {}, token = dzApiToken ?? '') {
  const url = new URL(DZ_GW)
  url.search = new URLSearchParams({ method, input: '3', api_version: '1.0', api_token: token }).toString()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...c.headers,
      accept: '*/*',
      'content-type': 'text/plain;charset=UTF-8',
      cookie: cookieHeader(c.cookies),
      origin: 'https://www.deezer.com',
      referer: 'https://www.deezer.com/',
    },
    body: JSON.stringify(params),
  })
  if (absorbCookies(c, res)) await saveCreds('deezer', c)
  if (res.status === 401 || res.status === 403) throw new AuthFailed()
  if (!res.ok) throw new Error(`Deezer ${res.status} on ${method}`)
  const body: any = await res.json()
  const err = body.error
  if (err && (Array.isArray(err) ? err.length : Object.keys(err).length)) {
    const keys = Object.keys(err).join(',')
    if (/TOKEN|AUTH|USER/i.test(keys)) {
      dzApiToken = null // the retry fetches a fresh one
      throw new AuthFailed()
    }
    throw new Error(`Deezer ${method}: ${JSON.stringify(err)}`)
  }
  return body.results
}

async function dzSession(c: Credentials) {
  const r = await dzCall(c, 'deezer.getUserData', {}, '')
  if (!r?.USER?.USER_ID) throw new AuthFailed()
  dzApiToken = r.checkForm
  const uid = String(r.USER.USER_ID)
  if (c.userId !== uid) {
    c.userId = uid
    c.username = r.USER.BLOG_NAME
    await saveCreds('deezer', c)
  }
  return uid
}

function dzTrack(t: any, addedAt?: number): FavItem {
  const id = String(t.SNG_ID)
  const title = t.VERSION ? `${t.SNG_TITLE} ${t.VERSION}` : t.SNG_TITLE
  return {
    id: `deezer:track:${id}`,
    platform: 'deezer',
    kind: 'track',
    nativeId: id,
    title,
    artist: t.ART_NAME ?? '',
    durationSec: Number(t.DURATION) || 0,
    url: `https://www.deezer.com/track/${id}`,
    artwork: t.ALB_PICTURE
      ? `https://e-cdns-images.dzcdn.net/images/cover/${t.ALB_PICTURE}/250x250-000000-80-0-0.jpg`
      : undefined,
    embedUrl: `https://widget.deezer.com/widget/dark/track/${id}?autoplay=true`,
    genre: t.ALB_TITLE ? `album: ${t.ALB_TITLE}` : undefined,
    addedAt: addedAt ? new Date(addedAt * 1000).toISOString() : undefined,
  }
}

async function deezerFavorites(): Promise<FavItem[]> {
  return withCreds('deezer', async (c) => {
    if (!c.cookies.arl) throw new AuthFailed()
    await dzSession(c)
    const fav = await dzCall(c, 'song.getFavoriteIds', { nb: 10000, start: 0, checksum: null })
    const ids: { SNG_ID: string | number; DATE_ADD?: number }[] = fav?.data ?? []
    const added = new Map(ids.map((x) => [String(x.SNG_ID), x.DATE_ADD]))
    const out: FavItem[] = []
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200).map((x) => String(x.SNG_ID))
      const r = await dzCall(c, 'song.getListData', { sng_ids: chunk })
      for (const t of r?.data ?? []) out.push(dzTrack(t, added.get(String(t.SNG_ID))))
    }
    return out
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

/** Both catalogs, interleaved (a platform that fails or isn't connected is just left out). */
export async function searchCatalogs(query: string, nb = 30): Promise<FavItem[]> {
  const [sc, dz] = await Promise.all(
    [searchSoundcloud(query, nb), searchDeezer(query, nb)].map((p) =>
      p.catch((e) => (console.error('[search]', e?.message ?? e), [] as FavItem[])),
    ),
  )
  const out: FavItem[] = []
  for (let i = 0; i < Math.max(sc!.length, dz!.length); i++) {
    if (dz![i]) out.push(dz![i]!)
    if (sc![i]) out.push(sc![i]!)
  }
  return out
}

/** Search the whole Deezer catalog, exactly like the search box on deezer.com. */
const dzSearchCache = new Map<string, { at: number; items: FavItem[] }>()
export async function searchDeezer(query: string, nb = 30): Promise<FavItem[]> {
  const key = query.trim().toLowerCase()
  if (key.length < 2) return []
  const hit = dzSearchCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.items
  const items = await withCreds('deezer', async (c) => {
    if (!c.cookies.arl) throw new AuthFailed()
    if (!dzApiToken) await dzSession(c)
    const r = await dzCall(c, 'deezer.pageSearch', {
      query: query.trim(), start: 0, nb, suggest: true, artist_suggest: true, top_tracks: true,
    })
    return ((r?.TRACK?.data ?? []) as any[]).map((t) => dzTrack(t))
  })
  if (dzSearchCache.size > 300) dzSearchCache.clear()
  dzSearchCache.set(key, { at: Date.now(), items })
  return items
}

/** Look up one Deezer track by its native ID (for requests of non-favorites). */
export async function deezerTrack(nativeId: string): Promise<FavItem | null> {
  if (!/^\d+$/.test(nativeId)) return null
  for (const { items } of dzSearchCache.values()) {
    const f = items.find((i) => i.nativeId === nativeId)
    if (f) return f
  }
  return withCreds('deezer', async (c) => {
    if (!dzApiToken) await dzSession(c)
    const r = await dzCall(c, 'song.getListData', { sng_ids: [nativeId] })
    const t = r?.data?.[0]
    return t ? dzTrack(t) : null
  })
}

// ------------------------------------------------------------------- shared

export async function fetchFavorites(p: Platform) {
  return p === 'soundcloud' ? soundcloudFavorites() : deezerFavorites()
}

/** Cheap check that stored credentials still work (with silent refresh). */
export async function verify(p: Platform): Promise<{ ok: true; username?: string } | { ok: false; reason: string }> {
  try {
    const username = await withCreds(p, async (c) => {
      if (p === 'soundcloud') {
        if (!c.clientId || !c.oauthToken) throw new AuthFailed()
        return (await scMe(c)).username as string
      }
      if (!c.cookies.arl) throw new AuthFailed()
      await dzSession(c)
      return c.username
    })
    return { ok: true, username }
  } catch (e: any) {
    return { ok: false, reason: e instanceof NeedsLogin ? 'login required' : e.message }
  }
}
