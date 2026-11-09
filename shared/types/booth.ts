/** Booth (effects) state shared by the server hub and every open player page. */

export type ColorPreset = 'off' | 'radio' | 'phone' | 'vinyl'
export type VoicePreset = 'tannoy' | 'robot' | 'chipmunk' | 'monster'

export interface Eq {
  low: number
  mid: number
  high: number
}

/** XY pad position, 0..1 both ways (x: low-pass ← clean → high-pass; y: resonance + echo). */
export interface XY {
  x: number
  y: number
}

export interface BoothState {
  eq: Eq
  color: ColorPreset
  duckDb: number
  padVolume: number
  talkover: boolean
  echo: boolean
  brake: boolean
  /** XY filter pad while a finger is on it, else null. */
  xy: XY | null
  pads: string[] // playing now
}

/** A soundboard pad, as listed by `GET /api/pads`. */
export interface Pad {
  id: string
  emoji: string
  label: string
  durationSec?: number
  /** Recorded from the booth mic (can be deleted). */
  recorded?: boolean
}

/** Server-sent events on `/api/fx/events`. `from` is the page that caused it. */
export type BoothEvent =
  | { type: 'state'; state: BoothState; from?: string }
  | { type: 'pad'; id: string; on: boolean; from?: string }
  | { type: 'stopPads'; from?: string }
  | { type: 'echoOut'; from?: string }
  | { type: 'padsChanged'; from?: string }

/** How far the music ducks under talkover / pads by default (dB). */
export const DEFAULT_DUCK_DB = 10
