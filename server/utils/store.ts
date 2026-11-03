import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const DATA_DIR = resolve(process.env.DATA_DIR || 'data')

export type Platform = 'soundcloud' | 'deezer'
export const PLATFORMS: Platform[] = ['soundcloud', 'deezer']

export function isPlatform(p: unknown): p is Platform {
  return p === 'soundcloud' || p === 'deezer'
}

export interface Credentials {
  capturedAt: string
  /** Headers copied from a real browser request to the platform API (no cookie/auth). */
  headers: Record<string, string>
  cookies: Record<string, string>
  userAgent: string
  /** SoundCloud only. */
  clientId?: string
  oauthToken?: string
  userId?: string
  username?: string
}

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
  mood?: string
  note?: string
  /** Set when the item came from an approved guest request. */
  requestedBy?: string
}

export interface Evening {
  title: string
  startTime: string // "HH:MM"
  items: EveningEntry[]
  /** Incremented on every save; lets clients detect changes made elsewhere. */
  rev?: number
}

const EMPTY_EVENING: Evening = { title: 'Chill & feels', startTime: '20:00', items: [], rev: 0 }
export const loadEvening = async () => ({ ...EMPTY_EVENING, ...(await readJson<Evening>('evening.json', EMPTY_EVENING)) })

let eveningLock: Promise<unknown> = Promise.resolve()
/** Serialised read-modify-write of the evening; bumps rev. */
export function updateEvening(fn: (e: Evening) => Evening | void | Promise<Evening | void>): Promise<Evening> {
  const p = eveningLock.then(async () => {
    const cur = await loadEvening()
    const next = (await fn(cur)) || cur
    next.rev = (cur.rev ?? 0) + 1
    await writeJson('evening.json', next)
    return next
  })
  eveningLock = p.catch(() => {})
  return p
}

export async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(DATA_DIR, name), 'utf8')) as T
  } catch {
    return fallback
  }
}

export async function writeJson(name: string, value: unknown) {
  await mkdir(DATA_DIR, { recursive: true })
  const file = join(DATA_DIR, name)
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
  await rename(tmp, file)
}

export const credsFile = (p: Platform) => `credentials-${p}.json`
export const favsFile = (p: Platform) => `favorites-${p}.json`
export const profileDir = (p: Platform) => join(DATA_DIR, 'profiles', p)

export const loadCreds = (p: Platform) => readJson<Credentials | null>(credsFile(p), null)
export const saveCreds = (p: Platform, c: Credentials) => writeJson(credsFile(p), c)
