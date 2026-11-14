import { cancelCapture } from '../../../utils/capture'
import { isPlatform } from '../../../utils/store'

/** The phone closed the login view: close the login browser. */
export default defineEventHandler((event) => {
  const p = getRouterParam(event, 'platform')
  if (!isPlatform(p)) throw createError({ statusCode: 404 })
  return { cancelled: cancelCapture(p) }
})
