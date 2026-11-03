/** Songs and playlists, as stored on the server and shown in the pages. */

export type Platform = 'soundcloud' | 'deezer'

export interface FavItem {
  id: string // "<platform>:<kind>:<native id>"
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

export interface FavCache {
  fetchedAt: string
  items: FavItem[]
}

export interface EveningEntry extends FavItem {
  note?: string
  /** Set when the item came from an approved guest request. */
  requestedBy?: string
}

export interface Playlist {
  id: string
  title: string
  startTime: string // "HH:MM"
  items: EveningEntry[]
}

/** All playlists; `open` is the one being edited (new songs land there). */
export interface Evening {
  playlists: Playlist[]
  open: string
  /** Incremented on every save; lets clients detect changes made elsewhere. */
  rev?: number
}

/** What guests may see of a track (no URLs or embed links). */
export type PublicItem = Pick<FavItem, 'id' | 'title' | 'artist' | 'artwork' | 'platform' | 'kind' | 'durationSec'>

/** Connection state of one platform (`GET /api/status`). */
export interface PlatformStatus {
  connected: boolean
  capturedAt?: string
  username?: string
  check?: { ok: boolean; username?: string; reason?: string; at: number }
  capture: { state: 'idle' | 'running' | 'error'; message?: string; interactive?: boolean }
  favorites: { count: number; fetchedAt: string } | null
}
