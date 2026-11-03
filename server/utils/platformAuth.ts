import type { Platform } from '#shared/types/music'
import { capture } from './capture'
import { loadCreds, type Credentials } from './store'

/**
 * Platform sessions: the credentials captured from a real browser login, replayed on every
 * API call, refreshed silently from the saved browser profile when they expire.
 */

/** A real login is needed (the UI asks the host to Connect). */
export class NeedsLogin extends Error {
  constructor(public platform: Platform, reason: string) {
    super(`${platform}: ${reason}`)
  }
}

export const cookieHeader = (c: Record<string, string>) =>
  Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ')

/** Merge Set-Cookie values into stored cookies, like a browser would. */
export function absorbCookies(creds: Credentials, res: Response) {
  const list = res.headers.getSetCookie?.() ?? []
  let changed = false
  for (const line of list) {
    const pair = line.split(';')[0] ?? ''
    const i = pair.indexOf('=')
    if (i <= 0) continue
    const k = pair.slice(0, i).trim()
    const v = pair.slice(i + 1).trim()
    if (creds.cookies[k] !== v) {
      creds.cookies[k] = v
      changed = true
    }
  }
  return changed
}

/**
 * Get usable credentials: stored ones, or a silent headless refresh from the saved
 * browser profile. Throws NeedsLogin when a real login is required.
 */
async function getCreds(p: Platform, forceRefresh = false): Promise<Credentials> {
  let c = forceRefresh ? null : await loadCreds(p)
  if (!c) c = await capture(p, false)
  if (!c) throw new NeedsLogin(p, 'not connected or session expired')
  return c
}

/** Run fn with credentials; on an auth failure, refresh silently once and retry. */
export async function withCreds<T>(p: Platform, fn: (c: Credentials) => Promise<T>): Promise<T> {
  try {
    return await fn(await getCreds(p))
  } catch (e) {
    if (!(e instanceof AuthFailed)) throw e
  }
  return fn(await getCreds(p, true)).catch((e) => {
    if (e instanceof AuthFailed) throw new NeedsLogin(p, 'session expired, log in again')
    throw e
  })
}

/** Thrown by an API call when the platform rejects the session (401/403, bad token). */
export class AuthFailed extends Error {}
