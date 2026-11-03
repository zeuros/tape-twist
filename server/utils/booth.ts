import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { readJson, writeJson } from './store'

/**
 * Booth state hub. The effects (pads, colour, echo, talkover, EQ) are applied by each
 * listening browser with Web Audio, so the device you press on reacts instantly.
 * The server only holds the shared state and relays events to every open page (SSE),
 * so all listening devices play the same thing.
 */

export const PADS_DIR = resolve(process.env.PADS_DIR || 'pads')
const HOLD_TIMEOUT = 6000 // a held button must be refreshed within this (lost touch-up safety)
const run = promisify(execFile)

export type ColorPreset = 'off' | 'radio' | 'phone' | 'vinyl'
export const COLORS: ColorPreset[] = ['off', 'radio', 'phone', 'vinyl']

export interface Eq {
  low: number
  mid: number
  high: number
}

export interface BoothState {
  eq: Eq
  color: ColorPreset
  duckDb: number
  padVolume: number
  talkover: boolean
  echo: boolean
  pads: string[] // playing now
}

export interface PadInfo {
  id: string
  emoji: string
  label: string
  file: string
  durationSec: number
}

export type BoothEvent =
  | { type: 'state'; state: BoothState; from?: string }
  | { type: 'pad'; id: string; on: boolean; from?: string }
  | { type: 'stopPads'; from?: string }
  | { type: 'echoOut'; from?: string }

type Persisted = Pick<BoothState, 'eq' | 'color' | 'duckDb' | 'padVolume'>

class Booth {
  private s: Persisted = { eq: { low: 0, mid: 0, high: 0 }, color: 'off', duckDb: 10, padVolume: 0.8 }
  private holds = { talkover: 0, echo: 0 }
  private holdTimers: Record<string, ReturnType<typeof setTimeout>> = {}
  private playing = new Map<string, ReturnType<typeof setTimeout>>()
  private subs = new Set<(e: BoothEvent) => void>()
  private loaded: Promise<void> | null = null
  private padList: Promise<PadInfo[]> | null = null

  init() {
    this.loaded ??= readJson<Partial<Persisted>>('fx.json', {}).then((fx) => {
      Object.assign(this.s, fx)
    })
    return this.loaded
  }

  get state(): BoothState {
    const now = Date.now()
    return {
      ...this.s,
      talkover: now < this.holds.talkover,
      echo: now < this.holds.echo,
      pads: [...this.playing.keys()],
    }
  }

  subscribe(fn: (e: BoothEvent) => void) {
    this.subs.add(fn)
    return () => this.subs.delete(fn)
  }

  private emit(e: BoothEvent) {
    for (const fn of this.subs) {
      try {
        fn(e)
      } catch {
        /* a dead connection is removed by its own close handler */
      }
    }
  }

  private emitState(from?: string) {
    this.emit({ type: 'state', state: this.state, from })
  }

  async set(p: Partial<Persisted>, from?: string) {
    await this.init()
    Object.assign(this.s, p)
    this.emitState(from)
    await writeJson('fx.json', this.s)
  }

  /** Hold buttons: on=true is re-sent every 2 s while held; released after 6 s of silence. */
  hold(name: 'talkover' | 'echo', on: boolean, from?: string) {
    const was = Date.now() < this.holds[name]
    this.holds[name] = on ? Date.now() + HOLD_TIMEOUT : 0
    clearTimeout(this.holdTimers[name])
    if (on) this.holdTimers[name] = setTimeout(() => this.emitState(), HOLD_TIMEOUT + 50)
    if (was !== on) this.emitState(from)
  }

  async pad(id: string, on: boolean, from?: string) {
    const pad = (await this.pads()).find((p) => p.id === id)
    if (!pad) throw new Error(`Unknown pad ${id}`)
    clearTimeout(this.playing.get(id))
    this.playing.delete(id)
    if (on) {
      this.playing.set(id, setTimeout(() => {
        this.playing.delete(id)
        this.emitState()
      }, pad.durationSec * 1000 + 100))
    }
    this.emit({ type: 'pad', id, on, from })
    this.emitState(from)
  }

  stopPads(from?: string) {
    for (const t of this.playing.values()) clearTimeout(t)
    this.playing.clear()
    this.emit({ type: 'stopPads', from })
    this.emitState(from)
  }

  echoOut(from?: string) {
    this.emit({ type: 'echoOut', from })
  }

  /** Pads from pads/pads.json, with their length (needed to know when they stop). */
  pads() {
    this.padList ??= (async () => {
      const list = JSON.parse(await readFile(join(PADS_DIR, 'pads.json'), 'utf8')) as PadInfo[]
      const out: PadInfo[] = []
      for (const p of list) {
        try {
          const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(PADS_DIR, p.file)])
          const d = Number.parseFloat(stdout)
          if (d > 0) out.push({ ...p, durationSec: d })
        } catch (e) {
          console.error('[pads] cannot read', p.file, e)
        }
      }
      return out
    })().catch((e) => {
      this.padList = null
      throw e
    })
    return this.padList
  }
}

export const booth = new Booth()
