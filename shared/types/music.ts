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
  /** SoundCloud Go+: this account only gets a 30 s preview (found songs never are; only likes). */
  preview?: boolean
}

export interface FavCache {
  fetchedAt: string
  items: FavItem[]
}

export interface EveningEntry extends FavItem {
  note?: string
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


/** Connection state of one platform (`GET /api/status`). */
export interface PlatformStatus {
  connected: boolean
  capturedAt?: string
  username?: string
  check?: { ok: boolean; username?: string; reason?: string; at: number }
  capture: { state: 'idle' | 'running' | 'error'; message?: string; interactive?: boolean }
  favorites: { count: number; fetchedAt: string } | null
}
