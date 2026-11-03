import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'

/** Anonymous guest ID (cookie), used to count votes and cap pending requests. */
export const GUEST_COOKIE = 'em_guest'
export function guestId(event: H3Event) {
  let id = getCookie(event, GUEST_COOKIE)
  if (!id || !/^[a-f0-9]{32}$/.test(id)) {
    id = randomBytes(16).toString('hex')
    setCookie(event, GUEST_COOKIE, id, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 86400, path: '/' })
  }
  return id
}
