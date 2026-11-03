import type { FavItem, Platform } from '#shared/types/music'
import { deezerFavorites, deezerUsername, searchDeezer } from './deezer'
import { NeedsLogin, withCreds } from './platformAuth'
import { searchSoundcloud, soundcloudFavorites, soundcloudUsername } from './soundcloud'

/** What the rest of the server asks of "the platforms", whichever one it is. */

export function fetchFavorites(p: Platform): Promise<FavItem[]> {
  return p === 'soundcloud' ? soundcloudFavorites() : deezerFavorites()
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

/** Cheap check that stored credentials still work (with silent refresh). */
export async function verify(p: Platform): Promise<{ ok: true; username?: string } | { ok: false; reason: string }> {
  try {
    const username = await withCreds(p, (c) => (p === 'soundcloud' ? soundcloudUsername(c) : deezerUsername(c)))
    return { ok: true, username }
  } catch (e: any) {
    return { ok: false, reason: e instanceof NeedsLogin ? 'login required' : e.message }
  }
}
