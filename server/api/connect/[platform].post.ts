import { capture } from '../../utils/capture'
import { isPlatform } from '../../utils/store'

// Opens a visible browser window on the machine running the server; the user logs in there.
export default defineEventHandler((event) => {
  const p = getRouterParam(event, 'platform')
  if (!isPlatform(p)) throw createError({ statusCode: 404 })
  void capture(p, true)
  return { started: true }
})
