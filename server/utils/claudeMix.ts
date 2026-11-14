import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { searchCatalogs } from './platforms'
import { soundcloudRelated } from './soundcloud'
import type { FavItem } from '#shared/types/music'

/**
 * "Ask Claude" for the evening: a one-line request ("calm bass music for ambience, go around
 * Kebuffeule (Iorie remix)") becomes real SoundCloud/Deezer tracks. Claude runs through the
 * Claude Code CLI on this machine (`claude -p`, the host's own login; no API key needed).
 *
 * Two steps: Claude turns the request into catalog searches; the server gathers real results
 * (plus SoundCloud's related tracks of the reference songs); Claude picks from that list.
 */

export interface MixRequest {
  prompt: string
  count: number
  /** What the playlist already holds (avoid repeats, follow its vibe). */
  current: { artist: string; title: string }[]
  /** Index in `current` of the song playing now (-1: nothing). It and the ones before it stay put. */
  playingIndex: number
  playlistTitle?: string
}
/** One slot of the rearranged upcoming part: an existing song (index in `current`) or a new one (index in `items`). */
export type Slot = { cur: number } | { add: number }
export interface MixResult {
  /** The new songs. */
  items: FavItem[]
  /**
   * The upcoming part of the playlist (everything after `playingIndex`) as Claude laid it out,
   * every upcoming song exactly once, new ones placed among them. Absent: append `items`.
   */
  arrangement?: Slot[]
  note: string
  ms: number
}

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude'
const MODEL = process.env.CLAUDE_MIX_MODEL || 'claude-opus-5-5'
const EFFORT = process.env.CLAUDE_MIX_EFFORT || 'low'

const PRE_PROMPT = `You choose music for "Tape Twist", a DJ app playing a house party among friends.
The host types a one-line request: a mood, genres, a use ("for ambience", "to dance", "dinner"),
and sometimes reference tracks or artists. "Go around X" / "like X" / "around X" means: songs with
the same vibe, sound and scene as X (its artists, labels, remixers, neighbours), not X itself
unless asked; X may be included once at most.
Rules:
- Real, existing recordings only, findable on SoundCloud or Deezer. Exact artist and title
  spelling; include the remix/edit name in the title when it is the version you mean.
- Variety: at most 2 songs per artist. Nothing already in the playlist.
- Order them as a set that flows: energy and tempo evolving smoothly, no jarring jumps.
- Match the request's language/scene when it implies one (e.g. French, German minimal).
- The upcoming songs of the playlist are numbered P0, P1… You have some latitude with them:
  place the new songs between them where they fit best (not only at the end), and move upcoming
  songs when the request asks for it ("group the sea shanties", "put X after Y", "end on
  something calm") or when a move clearly makes the set flow better. Don't reshuffle for its own
  sake, and never drop one: songs can't be removed. Songs already played stay where they are.
- "note": one short sentence for the host about what you did (same language as the request);
  mention any songs you moved.`

/** First upcoming song (after the one playing). */
const upFrom = (r: MixRequest) => Math.max(0, r.playingIndex + 1)

function context(r: MixRequest) {
  const s = upFrom(r)
  const played = r.current.slice(Math.max(0, s - 8), s).map((c) => `- ${c.artist} — ${c.title}`).join('\n')
  const up = r.current.slice(s).map((c, i) => `P${i}|${c.artist} — ${c.title}`).join('\n')
  return `Playlist${r.playlistTitle ? ` "${r.playlistTitle}"` : ''} holds ${r.current.length} songs.
${played ? `Already played or playing (last ones, fixed):\n${played}\n` : ''}${up ? `Upcoming, in play order:\n${up}` : 'Nothing upcoming.'}
Host request: ${r.prompt}`
}

// ------------------------------------------------------------------ claude

let queue: Promise<unknown> = Promise.resolve()

/** One headless Claude Code call with a JSON-schema-constrained answer. One at a time. */
function askClaude<T>(prompt: string, schema: object): Promise<T> {
  const run = () =>
    new Promise<T>((resolve, reject) => {
      const args = [
        '-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema),
        '--model', MODEL, '--effort', EFFORT,
        '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence',
      ]
      // Prompt on stdin (candidate lists can exceed the per-argument size limit); run outside
      // the project so no CLAUDE.md or project settings are loaded.
      const child = spawn(CLAUDE_BIN, args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      const timer = setTimeout(() => child.kill('SIGTERM'), 150_000)
      child.stdout.on('data', (d) => (out += d))
      child.stderr.on('data', (d) => (err += d))
      child.on('error', (e: any) =>
        reject(new Error(e?.code === 'ENOENT' ? 'Claude Code CLI not found (set CLAUDE_BIN)' : e.message)),
      )
      child.on('close', (code) => {
        clearTimeout(timer)
        try {
          const events = JSON.parse(out)
          const res = (Array.isArray(events) ? events : [events]).find((e: any) => e?.type === 'result')
          if (!res || res.is_error || !res.structured_output) throw new Error(res?.result || err.trim() || `claude exited ${code}`)
          resolve(res.structured_output as T)
        } catch (e: any) {
          reject(new Error(`Claude: ${String(e?.message ?? e).slice(0, 300)}`))
        }
      })
      child.stdin.end(prompt)
    })
  const p = queue.then(run, run)
  queue = p.catch(() => {})
  return p
}

const NOTE = { type: 'string' }
const ORDER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['order', 'note'],
  properties: {
    note: NOTE,
    order: {
      type: 'array',
      items: { type: 'string', pattern: '^[PN][0-9]+$' },
      description: 'The whole upcoming part in play order: every P exactly once, plus the chosen N songs placed among them',
    },
  },
}
const SEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['references', 'queries'],
  properties: {
    references: { type: 'array', items: { type: 'string' }, description: 'Search queries for reference tracks named in the request (artist + title), if any' },
    queries: { type: 'array', items: { type: 'string' }, description: 'Catalog search queries likely to surface fitting tracks' },
  },
}

// --------------------------------------------------------------- matching

const norm = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\((official|lyric|audio|video|clip)[^)]*\)|\[(official|lyric|audio|video|clip)[^\]]*\]/g, ' ')
    .replace(/\b(feat|ft|featuring)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim()
async function mapLimit<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (i < xs.length) {
      const k = i++
      out[k] = await fn(xs[k]!)
    }
  }))
  return out
}

const dur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const line = (i: number, f: FavItem) => `N${i}|${f.artist} — ${f.title}|${dur(f.durationSec)}${f.genre ? `|${f.genre}` : ''}`
const key = (a: string, t: string) => norm(`${a} ${t}`)

// ------------------------------------------------------------------- dig

async function choose(r: MixRequest, pool: FavItem[], what: string) {
  const s = upFrom(r)
  const upCount = r.current.length - s
  if (!pool.length && !upCount) throw new Error('Nothing to choose from (are the platforms connected?)')
  const candidates = pool.length
    ? `${what} Lines are "N<number>|artist — title|length|genre". Choose up to ${r.count} of them (fewer if not enough fit, none if the request only asks to rearrange).\n\n${pool.map((f, i) => line(i, f)).join('\n')}`
    : 'No new songs this time: only rearrange the upcoming ones as asked.'
  const a = await askClaude<{ order: string[]; note: string }>(
    `${PRE_PROMPT}\n\n${context(r)}\n\n${candidates}\n\nAnswer with "order": the whole upcoming part as it should play, P and N numbers mixed.`,
    ORDER_SCHEMA,
  )
  const items: FavItem[] = []
  const slots: Slot[] = []
  const usedP = new Set<number>()
  for (const tok of a.order) {
    const n = Number(tok.slice(1))
    if (tok[0] === 'P') {
      if (n < upCount && !usedP.has(n)) {
        usedP.add(n)
        slots.push({ cur: s + n })
      }
    } else {
      const f = pool[n]
      if (f && !items.includes(f) && items.length < r.count) {
        slots.push({ add: items.length })
        items.push(f)
      }
    }
  }
  // A song Claude forgot goes back right after the song it followed (or first).
  for (let n = 0; n < upCount; n++) {
    if (usedP.has(n)) continue
    const after = slots.findIndex((x) => 'cur' in x && x.cur === s + n - 1)
    slots.splice(after + 1, 0, { cur: s + n })
    usedP.add(n)
  }
  const moved = slots.some((x, i) => 'cur' in x && slots.slice(0, i).some((y) => 'cur' in y && y.cur > x.cur))
  const inserted = slots.some((x, i) => 'add' in x && slots.slice(i).some((y) => 'cur' in y))
  return { items, note: a.note, arrangement: moved || inserted ? slots : undefined }
}

async function dig(r: MixRequest) {
  const plan = await askClaude<{ references: string[]; queries: string[] }>(
    `${PRE_PROMPT}\n\n${context(r)}\n\nFirst step: write catalog searches (SoundCloud and Deezer search boxes) that will surface candidates: the reference tracks named in the request (if any), then 6-10 queries (artists, labels, remixers, genre words) for songs that fit. If the request only asks to rearrange the playlist (no new songs wanted), return no queries and no references.`,
    SEARCH_SCHEMA,
  )
  const have = new Set(r.current.map((c) => key(c.artist, c.title)))
  const pool: FavItem[] = []
  const seen = new Set<string>()
  const add = (xs: FavItem[]) => {
    for (const f of xs) {
      const k = key(f.artist, f.title)
      if (f.kind !== 'track' || seen.has(f.id) || seen.has(k) || have.has(k) || f.durationSec < 60) continue
      seen.add(f.id)
      seen.add(k)
      pool.push(f)
    }
  }
  // Reference tracks: their SoundCloud "related" station is the best "go around X".
  const refs = await mapLimit(plan.references.slice(0, 3), 3, (q) => searchCatalogs(q, 5).catch(() => []))
  const related = await mapLimit(
    refs.map((rs) => rs.find((f) => f.platform === 'soundcloud' && f.kind === 'track')).filter(Boolean) as FavItem[],
    3,
    (f) => soundcloudRelated(f.nativeId, 40).catch(() => []),
  )
  for (const xs of related) add(xs)
  for (const xs of await mapLimit(plan.queries.slice(0, 10), 4, (q) => searchCatalogs(q, 12).catch(() => []))) add(xs)
  return choose(r, pool.slice(0, 220), 'Here are real tracks found in the catalogs.')
}

export async function claudeMix(r: MixRequest): Promise<MixResult> {
  const t0 = Date.now()
  return { ...(await dig(r)), ms: Date.now() - t0 }
}
