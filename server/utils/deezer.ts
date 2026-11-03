import type { FavItem } from '#shared/types/music'
import { absorbCookies, AuthFailed, cookieHeader, withCreds } from './platformAuth'
import { saveCreds, type Credentials } from './store'

/** Deezer's own web gateway (gw-light.php), with the captured `arl` session cookie. */

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

export async function deezerFavorites(): Promise<FavItem[]> {
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

/** The logged-in user's name (checks that the session works). */
export async function deezerUsername(c: Credentials): Promise<string | undefined> {
  if (!c.cookies.arl) throw new AuthFailed()
  await dzSession(c)
  return c.username
}
