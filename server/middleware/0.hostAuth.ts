import { isHost } from '../utils/hostAuth'

/**
 * The API and the APK need the PIN cookie. Open to all: the front-end files (they only show the
 * lock screen without it) and the PIN check itself (/api/auth). The front-end code is public
 * anyway (every route is visible in it): the server is what says no.
 */
export default defineEventHandler(async (event) => {
  if (process.env.TAPE_TWIST_E2E === '1') return
  const path = event.path.split('?')[0]!
  const guarded = (path.startsWith('/api/') && path !== '/api/auth') || path === '/tape-twist.apk'
  if (guarded && !(await isHost(event))) throw createError({ statusCode: 401, statusMessage: 'PIN required' })
})
