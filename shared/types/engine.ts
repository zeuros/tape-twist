import type { FavItem, PublicItem } from './music'

export type EngineStatus = 'stopped' | 'playing' | 'paused'

export interface EngineSettings {
  crossfade: number
  /** Cut the outgoing bass / bring in the incoming bass at the middle of a crossfade. */
  bassSwap: boolean
  /** Level added to Deezer tracks so they match SoundCloud's (dB). */
  deezerBoostDb: number
  /** Level applied to SoundCloud tracks (dB, usually negative: leaves headroom so the mix doesn't saturate). */
  soundcloudLevelDb: number
  /** Pause after this many hours of continuous playback (0 = never). */
  autoPauseHours: number
  /** Pause when nobody has been listening for this many minutes (0 = never). */
  idlePauseMin: number
}

/** Factory settings (also what "reset" in Transitions & safety goes back to). */
export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  crossfade: 6,
  bassSwap: true,
  // Deezer plays ~12 dB quieter than SoundCloud (see README). Rather than lifting Deezer all the
  // way (which saturates), SoundCloud comes down 9 dB and Deezer goes up 3 dB.
  deezerBoostDb: 3,
  soundcloudLevelDb: -9,
  autoPauseHours: 6,
  idlePauseMin: 15,
}

/** The engine as the player sees it (`GET /api/engine`, and every command's reply). */
export interface EngineSnapshot {
  status: EngineStatus
  fading: boolean
  /** What's being opened on a deck (from the play command until it really plays). */
  loading: Pick<FavItem, 'id' | 'title' | 'artist' | 'artwork'> | null
  current: FavItem | null
  currentId: string | null
  adhoc: boolean
  posSec: number
  durSec: number
  next: Pick<FavItem, 'id' | 'title' | 'artist'> | null
  crossfade: number
  settings: EngineSettings
  listeners: number
  error: string
  notice: string
}

/** Engine snapshot plus what the host UI needs to know about shared state. */
export interface HostStatus extends EngineSnapshot {
  eveningRev: number
  pendingRequests: number
}

export type RequestStatus = 'pending' | 'approved' | 'rejected'

/** A guest request as the host sees it (`GET /api/requests`). */
export interface HostRequest {
  id: string
  item: FavItem
  guestName: string
  votes: number
  status: RequestStatus
  createdAt: string
  decidedAt?: string
}

/** What a guest page shows (`GET /api/guest/state`). */
export interface GuestState {
  title: string
  now: (PublicItem & { status: EngineStatus; posSec: number; durSec: number }) | null
  upNext: (PublicItem & { requestedBy?: string })[]
  requests: {
    id: string
    item: PublicItem
    guestName: string
    votes: number
    voted: boolean
    mine: boolean
    status: 'pending' | 'approved'
  }[]
}

/** A guest search hit (`GET /api/guest/search`). */
export type GuestSearchItem = PublicItem & { fav?: boolean }
