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
  /** Pitch ▲ / ▼ held: the music bends up / down while held, and glides back on release. */
  pitchUp: boolean
  pitchDown: boolean
  talkover: boolean
  echo: boolean
  brake: boolean
  /** Rewind held: the music spins backwards, then drops back in live. */
  rewind: boolean
  /** Build-up held: bass filtered out, riser and snare roll; letting go is the drop. */
  build: boolean
  /** Stutter held: loop length in beats (1, 1/2, 1/4, 1/8), else null. */
  stutter: number | null
  /** XY filter pad while a finger is on it, else null. */
  xy: XY | null
  pads: string[] // playing now
  /** Light show: every listening phone's screen flashes on the kicks. */
  lights: boolean
  /** Tempo of the music, measured on the server (null: unsure). */
  bpm: number | null
}

/** Pitch buttons: how far a hold bends, how fast (semitones per second), and the glide back (s). */
export const PITCH_MAX = 12
export const PITCH_SPEED = 1.5
export const PITCH_RELEASE = 0.3

export const STUTTER_BEATS = [1, 1 / 2, 1 / 4, 1 / 8] as const
/** Tempo used while the server isn't sure of it. */
export const DEFAULT_BPM = 124

/** A soundboard pad, as listed by `GET /api/pads`. */
export interface Pad {
  id: string
  emoji: string
  label: string
  durationSec?: number
  /** Added from the booth (mic or myinstants): can be deleted. */
  recorded?: boolean
  /** Tile colour (pads added from myinstants). */
  color?: string
}

/** Server-sent events on `/api/fx/events`. `from` is the page that caused it. */
export type BoothEvent =
  | { type: 'state'; state: BoothState; from?: string }
  | { type: 'pad'; id: string; on: boolean; from?: string }
  | { type: 'stopPads'; from?: string }
  | { type: 'padsChanged'; from?: string }

/** How far the music ducks under talkover / pads by default (dB). */
export const DEFAULT_DUCK_DB = 10
