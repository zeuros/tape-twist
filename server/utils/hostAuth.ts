import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { DATA_DIR } from './store'

/**
 * The host PIN: everything but the guest page needs it (see server/middleware/0.hostAuth.ts).
 * A right PIN sets a cookie holding HMAC(secret, PIN): it survives restarts, and changing the
 * PIN logs every device out. Wrong tries are throttled to one every 10 s, for
 * everyone at once (Funnel visitors can change address at will, so a per-IP limit wouldn't hold).
 */

export const HOST_COOKIE = 'tt_host'
const SECRET_FILE = join(DATA_DIR, 'host-secret')
const PIN_FILE = join(DATA_DIR, 'host-pin')

/** HOST_PIN, else data/host-pin (private, not in git), else 1234. */
let pinP: Promise<string> | null = null
const hostPin = () =>
  (pinP ??= (async () => process.env.HOST_PIN || (await readFile(PIN_FILE, 'utf8').catch(() => '')).trim() || '1234')())
export const RETRY_SEC = 10

let secret: Promise<Buffer> | null = null
function hostSecret() {
  secret ??= (async () => {
    try {
      const s = await readFile(SECRET_FILE)
      if (s.length >= 32) return s
    } catch {
      /* first run */
    }
    const s = randomBytes(32)
    await mkdir(DATA_DIR, { recursive: true })
    await writeFile(SECRET_FILE, s, { mode: 0o600 })
    return s
  })()
  return secret
}

const token = async () => createHmac('sha256', await hostSecret()).update(await hostPin()).digest()

const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b)

/** How many characters the PIN has, so the lock screen can submit as soon as they're typed. */
export const pinLength = async () => (await hostPin()).length

export async function isHost(event: H3Event) {
  const c = getCookie(event, HOST_COOKIE)
  if (!c || !/^[a-f0-9]{64}$/.test(c)) return false
  return same(Buffer.from(c, 'hex'), await token())
}

let nextTryAt = 0

/** Checks a PIN try: 'ok' (cookie set), 'wrong', or the seconds to wait before trying again. */
export async function tryPin(event: H3Event, pin: string): Promise<'ok' | 'wrong' | number> {
  const now = Date.now()
  if (now < nextTryAt) return Math.ceil((nextTryAt - now) / 1000)
  const a = createHmac('sha256', 'pin').update(pin).digest()
  const b = createHmac('sha256', 'pin').update(await hostPin()).digest()
  if (!same(a, b)) {
    nextTryAt = now + RETRY_SEC * 1000
    return 'wrong'
  }
  setCookie(event, HOST_COOKIE, (await token()).toString('hex'), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 365 * 86400,
  })
  return 'ok'
}
