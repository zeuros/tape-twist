import { isHost } from '../utils/hostAuth'

/**
 * Everything the host page uses needs the PIN cookie. Open to all: the guest page (/, the
 * front-end files), its API (/api/guest/*) and the PIN check itself (/api/auth). The front-end
 * code is public anyway (every route is visible in it): the server is what says no.
 */
export default defineEventHandler(async (event) => {
  if (process.env.TAPE_TWIST_E2E === '1') return
  const path = event.path.split('?')[0]!
  const guarded = (path.startsWith('/api/') && !path.startsWith('/api/guest/') && path !== '/api/auth') || path === '/tape-twist.apk'
  if (guarded && !(await isHost(event))) throw createError({ statusCode: 401, statusMessage: 'PIN required' })
})
