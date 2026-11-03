import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { searchCatalogs, soundcloudRelated } from './platforms'
import { favsFile, PLATFORMS, readJson, type FavCache, type FavItem } from './store'

/**
 * "Ask Claude" for the evening: a one-line request ("calm bass music for ambience, go around
 * Kebuffeule (Iorie remix)") becomes real SoundCloud/Deezer tracks. Claude runs through the
 * Claude Code CLI on this machine (`claude -p`, the host's own login; no API key needed).
 *
 * Three methods, to compare:
 *  - pick:  Claude names songs from what it knows; each is looked up with the catalog search.
 *  - dig:   Claude turns the request into searches; the server gathers real results (plus
 *           SoundCloud's related tracks of the reference songs); Claude picks from that list.
 *  - favs:  Claude picks among the host's liked tracks.
 */
export type MixMethod = 'pick' | 'dig' | 'favs'
export const MIX_METHODS: MixMethod[] = ['pick', 'dig', 'favs']

export interface MixRequest {
  prompt: string
  count: number
  method: MixMethod
  /** What the playlist already holds (avoid repeats, follow its vibe). */
  current: { artist: string; title: string }[]
  playlistTitle?: string
}
export interface MixResult {
  items: FavItem[]
  missing: string[]
  note: string
  method: MixMethod
  ms: number
}

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude'
const MODEL = process.env.CLAUDE_MIX_MODEL || 'claude-opus-5-5'
const EFFORT = process.env.CLAUDE_MIX_EFFORT || 'low'

const PRE_PROMPT = `You choose music for "Evening Mix", a DJ app playing a house party among friends.
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
- "note": one short sentence for the host about the direction you took (same language as the request).`

function context(r: MixRequest) {
  const cur = r.current.slice(-40).map((c) => `- ${c.artist} — ${c.title}`).join('\n')
  return `Playlist${r.playlistTitle ? ` "${r.playlistTitle}"` : ''} currently holds ${r.current.length} songs${cur ? `, ending with:\n${cur}` : '.'}
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
const SONGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['songs', 'note'],
  properties: {
    note: NOTE,
    songs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['artist', 'title'],
        properties: { artist: { type: 'string' }, title: { type: 'string' } },
      },
    },
  },
}
const PICKS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['picks', 'note'],
  properties: { note: NOTE, picks: { type: 'array', items: { type: 'integer' } } },
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
const tokens = (s: string) => new Set(norm(s).split(' ').filter((t) => t.length > 1 || /\d/.test(t)))
const cover = (need: Set<string>, hay: Set<string>) => {
  if (!need.size) return 1
  let n = 0
  for (const t of need) if (hay.has(t)) n++
  return n / need.size
}

/** Find a suggested song in the catalogs: the title must be there, and the artist mostly. */
async function resolve(s: { artist: string; title: string }): Promise<FavItem | null> {
  const results = (await searchCatalogs(`${s.artist} ${s.title}`, 10).catch(() => [])).filter((i) => i.kind === 'track')
  const title = tokens(s.title)
  const artist = tokens(s.artist)
  let best: FavItem | null = null
  let bestScore = 0
  for (const it of results) {
    const hay = tokens(`${it.artist} ${it.title}`)
    const t = cover(title, hay)
    const a = cover(artist, hay)
    if (t < 0.75 || a < 0.5) continue
    // Extra words in the result's title (another remix, "live", "extended") cost a little.
    const extra = [...tokens(it.title)].filter((w) => !title.has(w) && !artist.has(w)).length
    const score = t * 2 + a - extra * 0.08
    if (score > bestScore) [best, bestScore] = [it, score]
  }
  return best
}

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
const line = (i: number, f: FavItem) => `${i}|${f.artist} — ${f.title}|${dur(f.durationSec)}${f.genre ? `|${f.genre}` : ''}`
const key = (a: string, t: string) => norm(`${a} ${t}`)

// ---------------------------------------------------------------- methods

async function pick(r: MixRequest) {
  const ask = Math.ceil(r.count * 1.5) + 2 // some won't be found
  const a = await askClaude<{ songs: { artist: string; title: string }[]; note: string }>(
    `${PRE_PROMPT}\n\n${context(r)}\n\nSuggest ${ask} songs, in play order.`,
    SONGS_SCHEMA,
  )
  const found = await mapLimit(a.songs, 4, resolve)
  const items: FavItem[] = []
  const missing: string[] = []
  a.songs.forEach((s, i) => {
    const f = found[i]
    if (f && items.length < r.count && !items.some((x) => x.id === f.id)) items.push(f)
    else if (!f) missing.push(`${s.artist} — ${s.title}`)
  })
  return { items, missing, note: a.note }
}

async function choose(r: MixRequest, pool: FavItem[], what: string) {
  if (!pool.length) throw new Error('Nothing to choose from (are the platforms connected?)')
  const a = await askClaude<{ picks: number[]; note: string }>(
    `${PRE_PROMPT}\n\n${context(r)}\n\n${what} Lines are "number|artist — title|length|genre". Choose ${r.count} of them (fewer if not enough fit), in play order, and answer with their numbers.\n\n${pool.map((f, i) => line(i, f)).join('\n')}`,
    PICKS_SCHEMA,
  )
  const items: FavItem[] = []
  for (const n of a.picks) {
    const f = pool[n]
    if (f && !items.includes(f) && items.length < r.count) items.push(f)
  }
  return { items, missing: [], note: a.note }
}

async function dig(r: MixRequest) {
  const plan = await askClaude<{ references: string[]; queries: string[] }>(
    `${PRE_PROMPT}\n\n${context(r)}\n\nFirst step: write catalog searches (SoundCloud and Deezer search boxes) that will surface candidates: the reference tracks named in the request (if any), then 6-10 queries (artists, labels, remixers, genre words) for songs that fit.`,
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

async function favs(r: MixRequest) {
  const lists = await Promise.all(PLATFORMS.map((p) => readJson<FavCache | null>(favsFile(p), null)))
  const have = new Set(r.current.map((c) => key(c.artist, c.title)))
  const pool = lists
    .flatMap((l) => l?.items ?? [])
    .filter((f) => f.kind === 'track' && !have.has(key(f.artist, f.title)))
    .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
    .slice(0, 1500)
  return choose(r, pool, "Here are the host's liked tracks (most recently liked first).")
}

export async function claudeMix(r: MixRequest): Promise<MixResult> {
  const t0 = Date.now()
  const res = await (r.method === 'dig' ? dig(r) : r.method === 'favs' ? favs(r) : pick(r))
  return { ...res, method: r.method, ms: Date.now() - t0 }
}
