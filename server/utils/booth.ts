import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { DEFAULT_DUCK_DB, STUTTER_BEATS, type BoothEvent, type BoothState, type ColorPreset, type Pad, type XY } from '#shared/types/booth'
import { mixer } from './mixer'
import { DATA_DIR, readJson, writeJson } from './store'

/**
 * Booth state hub. The effects (pads, colour, echo, talkover, EQ) are applied by each
 * listening browser with Web Audio, so the device you press on reacts instantly.
 * The server only holds the shared state and relays events to every open page (SSE),
 * so all listening devices play the same thing.
 */

export const PADS_DIR = resolve(process.env.PADS_DIR || 'pads')
/** Pads recorded from the booth mic: private, next to the rest of the evening's data. */
export const REC_DIR = join(DATA_DIR, 'pads')
const REC_LIST = 'recorded-pads.json'
const REC_MAX_SEC = 6 // 4 s of voice + the reverb tail
const HOLD_TIMEOUT = 6000 // a held button must be refreshed within this (lost touch-up safety)
const run = promisify(execFile)

export const COLORS: ColorPreset[] = ['off', 'radio', 'phone', 'vinyl']

/** A pad and where its sound is (the file never leaves the server). */
export interface PadInfo extends Pad {
  file: string
  durationSec: number
}
type PadEntry = Omit<PadInfo, 'durationSec'>

type Persisted = Pick<BoothState, 'eq' | 'color' | 'duckDb' | 'padVolume'>
export type HoldName = 'talkover' | 'echo' | 'brake' | 'rewind' | 'build' | 'lights' | 'pitchUp' | 'pitchDown'

class Booth {
  private s: Persisted = { eq: { low: 0, mid: 0, high: 0 }, color: 'off', duckDb: DEFAULT_DUCK_DB, padVolume: 0.8 }
  private holds = { talkover: 0, echo: 0, brake: 0, rewind: 0, build: 0, lights: 0, pitchUp: 0, pitchDown: 0, stutter: 0, xy: 0 }
  private xy: XY | null = null
  private stutter: number | null = null
  private holdTimers: Record<string, ReturnType<typeof setTimeout>> = {}
  private playing = new Map<string, ReturnType<typeof setTimeout>>()
  private subs = new Set<(e: BoothEvent) => void>()
  private loaded: Promise<void> | null = null
  private padList: Promise<PadInfo[]> | null = null

  init() {
    this.loaded ??= readJson<Partial<Persisted> & { lights?: boolean; pitch?: number }>('fx.json', {}).then(({ lights: _old, pitch: _old2, ...fx }) => {
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
      brake: now < this.holds.brake,
      rewind: now < this.holds.rewind,
      build: now < this.holds.build,
      stutter: now < this.holds.stutter ? this.stutter : null,
      xy: now < this.holds.xy ? this.xy : null,
      pads: [...this.playing.keys()],
      lights: now < this.holds.lights,
      pitchUp: now < this.holds.pitchUp,
      pitchDown: now < this.holds.pitchDown,
      bpm: mixer.bpm,
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
  hold(name: HoldName, on: boolean, from?: string) {
    const was = Date.now() < this.holds[name]
    this.holds[name] = on ? Date.now() + HOLD_TIMEOUT : 0
    clearTimeout(this.holdTimers[name])
    if (on) this.holdTimers[name] = setTimeout(() => this.emitState(), HOLD_TIMEOUT + 50)
    if (was !== on) this.emitState(from)
  }

  /** XY pad moved (or let go: null). Held like the buttons, so a lost touch-up can't stick. */
  setXY(xy: XY | null, from?: string) {
    this.xy = xy
    this.holds.xy = xy ? Date.now() + HOLD_TIMEOUT : 0
    clearTimeout(this.holdTimers.xy)
    if (xy) this.holdTimers.xy = setTimeout(() => this.emitState(), HOLD_TIMEOUT + 50)
    this.emitState(from)
  }

  /** Stutter held (loop length in beats; null: let go). Held like the buttons. */
  setStutter(beats: number | null, from?: string) {
    const v = beats == null ? null : (STUTTER_BEATS.find((b) => Math.abs(b - beats) < 1e-6) ?? null)
    const was = this.state.stutter
    this.stutter = v
    this.holds.stutter = v ? Date.now() + HOLD_TIMEOUT : 0
    clearTimeout(this.holdTimers.stutter)
    if (v) this.holdTimers.stutter = setTimeout(() => this.emitState(), HOLD_TIMEOUT + 50)
    if (was !== v) this.emitState(from)
  }

  /** The tempo changed: phones size their beat effects from it. */
  tempoChanged() {
    this.emitState()
  }

  async pad(id: string, on: boolean, from?: string) {
    const pad = (await this.pads()).find((p) => p.id === id)
    // A page with an old pad list (it missed the deletion): a clean 404, it reloads its pads.
    if (!pad) throw createError({ statusCode: 404, statusMessage: 'That pad was deleted' })
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

  /** Where a pad's audio file is. */
  padPath(p: PadInfo) {
    return join(p.recorded ? REC_DIR : PADS_DIR, p.file)
  }

  /** Built-in pads (pads/pads.json) then recorded ones, with their length (needed to know when they stop). */
  pads() {
    this.padList ??= (async () => {
      const builtIn = JSON.parse(await readFile(join(PADS_DIR, 'pads.json'), 'utf8')) as PadEntry[]
      const recorded = (await readJson<PadEntry[]>(REC_LIST, [])).map((p) => ({ ...p, recorded: true }))
      const out: PadInfo[] = []
      for (const p of [...builtIn, ...recorded]) {
        try {
          const d = await probeDuration(this.padPath(p as PadInfo))
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

  private recLock: Promise<unknown> = Promise.resolve()
  private editRecorded(fn: (list: PadEntry[]) => Promise<PadEntry[]>) {
    const p = this.recLock.then(async () => {
      await writeJson(REC_LIST, await fn(await readJson<PadEntry[]>(REC_LIST, [])))
      this.padList = null
      this.emit({ type: 'padsChanged' })
    })
    this.recLock = p.catch(() => {})
    return p
  }

  /**
   * A pad recorded on a phone (WebM/Opus, MP4/AAC…): cut to 4 s, silence trimmed at both
   * ends, mono MP3. Throws if nothing audible is left.
   */
  async addRecorded(audio: Buffer, label: string) {
    const id = `rec-${Date.now().toString(36)}`
    await mkdir(REC_DIR, { recursive: true })
    const src = join(tmpdir(), `evening-${id}.in`)
    const out = join(REC_DIR, `${id}.mp3`)
    const trim = 'silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.03'
    try {
      await writeFile(src, audio, { mode: 0o600 })
      await run('ffmpeg', [
        '-v', 'error', '-y', '-i', src, '-t', String(REC_MAX_SEC), '-ac', '1',
        '-af', `${trim},areverse,${trim},areverse,afade=t=in:d=0.01`,
        '-c:a', 'libmp3lame', '-b:a', '128k', `${out}.tmp.mp3`,
      ])
      if (!((await probeDuration(`${out}.tmp.mp3`).catch(() => 0)) > 0.05)) throw new Error('Nothing audible was recorded')
      await rename(`${out}.tmp.mp3`, out)
    } finally {
      await rm(src, { force: true })
      await rm(`${out}.tmp.mp3`, { force: true })
    }
    const entry: PadEntry = { id, emoji: '🎤', label: label.trim().slice(0, 30) || 'My pad', file: `${id}.mp3` }
    await this.editRecorded(async (list) => [...list, entry])
    return entry
  }

  /** A sound from a myinstants.com page (or its direct .mp3 link): its title, a guessed emoji, a random colour. */
  async addInstant(link: string) {
    const page = myinstantsUrl(link)
    let audioUrl = page
    let title = ''
    if (!page.pathname.endsWith('.mp3')) {
      const html = await (await fetchMyinstants(page, 'text/html')).text()
      const og = /<meta[^>]+property="og:audio"[^>]+content="([^"]+)"/.exec(html)?.[1] ?? /\/media\/sounds\/[^"'\s]+\.mp3/.exec(html)?.[0]
      if (!og) throw new Error('No sound on that page')
      audioUrl = myinstantsUrl(new URL(decodeEntities(og), page).href)
      title = decodeEntities(/<h1[^>]*id="instant-page-title"[^>]*>([^<]*)/.exec(html)?.[1] ?? /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/.exec(html)?.[1] ?? '')
    }
    title = (title.trim() || decodeURIComponent(audioUrl.pathname.split('/').pop()!.replace(/\.mp3$/, '').replace(/_[A-Za-z0-9]{7}$/, ''))).replace(/[-_]+/g, ' ').trim()
    if (title === title.toUpperCase()) title = title.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())
    title = title.charAt(0).toUpperCase() + title.slice(1)
    const res = await fetchMyinstants(audioUrl, 'audio/mpeg')
    if (Number(res.headers.get('content-length') || 0) > INSTANT_MAX_BYTES) throw new Error('That sound is too big')
    const audio = Buffer.from(await res.arrayBuffer())
    if (audio.length > INSTANT_MAX_BYTES) throw new Error('That sound is too big')

    const id = `mi-${Date.now().toString(36)}`
    await mkdir(REC_DIR, { recursive: true })
    const src = join(tmpdir(), `evening-${id}.in`)
    const out = join(REC_DIR, `${id}.mp3`)
    try {
      await writeFile(src, audio, { mode: 0o600 })
      // Re-encoded: checks it really is audio, and caps it (a pad's length bounds how long it plays).
      await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vn', '-t', String(INSTANT_MAX_SEC), '-c:a', 'libmp3lame', '-b:a', '160k', `${out}.tmp.mp3`])
      if (!((await probeDuration(`${out}.tmp.mp3`).catch(() => 0)) > 0.05)) throw new Error('That sound is empty')
      await rename(`${out}.tmp.mp3`, out)
    } catch (e: any) {
      throw new Error(e?.message?.startsWith('That') ? e.message : 'Could not read that sound')
    } finally {
      await rm(src, { force: true })
      await rm(`${out}.tmp.mp3`, { force: true })
    }
    const entry: PadEntry = { id, emoji: guessEmoji(title), label: title.slice(0, 30) || 'Instant', file: `${id}.mp3`, color: `hsl(${Math.floor(Math.random() * 360)} 70% 50%)` }
    await this.editRecorded(async (list) => [...list, entry])
    return entry
  }

  async deleteRecorded(id: string) {
    let found = false
    await this.editRecorded(async (list) => {
      const p = list.find((x) => x.id === id)
      if (!p) return list
      found = true
      await rm(join(REC_DIR, p.file), { force: true })
      return list.filter((x) => x !== p)
    })
    return found
  }
}

const INSTANT_MAX_BYTES = 3 * 1024 * 1024
const INSTANT_MAX_SEC = 15

/** Only myinstants.com is ever fetched (the link comes from a phone). */
function myinstantsUrl(link: string) {
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`)
  } catch {
    throw new Error('That is not a myinstants link')
  }
  if (!/^(www\.)?myinstants\.com$/i.test(u.hostname)) throw new Error('That is not a myinstants link')
  u.protocol = 'https:'
  u.port = ''
  u.username = u.password = ''
  return u
}

async function fetchMyinstants(url: URL, accept: string) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (evening soundboard)', accept }, signal: AbortSignal.timeout(10_000) }).catch(() => {
    throw new Error('Could not reach myinstants')
  })
  myinstantsUrl(res.url) // followed redirects must stay on myinstants
  if (!res.ok) throw new Error(res.status === 404 ? 'That instant does not exist' : `myinstants answered ${res.status}`)
  return res
}

function decodeEntities(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

const EMOJI_WORDS: [RegExp, string][] = [
  [/boom|explo|bomb/i, '💥'], [/fart|\bpet\b/i, '💨'], [/laugh|lol|haha|rire/i, '😂'], [/bruh|moai/i, '🗿'],
  [/horn|mlg/i, '📯'], [/bell|ding/i, '🔔'], [/wrong|error|fail|buzzer|\bno+\b/i, '❌'], [/correct|\bwin\b|\byes\b|victory/i, '✅'],
  [/cricket/i, '🦗'], [/scream|\bcri\b|ahh/i, '😱'], [/sad|violin|cry/i, '😢'], [/drum|rimshot|ba dum/i, '🥁'],
  [/gun|shot|spas|pew/i, '🔫'], [/punch|\bhit\b|slap/i, '👊'], [/\bcat\b|meow/i, '🐱'], [/dog|bark|woof/i, '🐶'],
  [/among us|\bsus\b/i, '📮'], [/oof|roblox/i, '🧱'], [/camera|photo/i, '📸'], [/money|cash|apple ?pay/i, '💸'],
  [/music|song|guitar|piano/i, '🎵'], [/whistle/i, '😗'], [/wow|omg/i, '😮'], [/rizz/i, '😏'], [/dun dun|dramatic/i, '😨'],
]
const EMOJI_ANY = ['🎉', '🔊', '⚡', '🎺', '👾', '🦆', '🍕', '🚨', '🌶️', '🎯', '🪩', '🛸']

/** The emoji the title starts or ends with, else one matching a word, else a random one. */
function guessEmoji(title: string) {
  const own = /\p{Extended_Pictographic}\uFE0F?/u.exec(title)?.[0]
  return own ?? EMOJI_WORDS.find(([re]) => re.test(title))?.[1] ?? EMOJI_ANY[Math.floor(Math.random() * EMOJI_ANY.length)]!
}

async function probeDuration(file: string) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  return Number.parseFloat(stdout)
}

export const booth = new Booth()
mixer.onTempo(() => booth.tempoChanged())
