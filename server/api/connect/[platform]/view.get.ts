import { getView } from '../../../utils/remoteView'
import { isPlatform } from '../../../utils/store'

/** The login browser as it changes (frames), then its end (connected, failed or cancelled). */
export default defineEventHandler(async (event) => {
  const p = getRouterParam(event, 'platform')
  if (!isPlatform(p)) throw createError({ statusCode: 404 })
  // Connect was just called: the browser may take a moment to start (an older, finished
  // login's view is still there until then).
  let view = getView(p)
  for (let i = 0; (!view || view.ended) && i < 75; i++) {
    await new Promise((r) => setTimeout(r, 200))
    view = getView(p)
  }
  if (!view) throw createError({ statusCode: 409, statusMessage: 'No login in progress' })
  const stream = createEventStream(event)
  const off = view.subscribe((e) => void stream.push(JSON.stringify(e)).catch(() => {}))
  const ping = setInterval(() => void stream.push({ event: 'ping', data: String(Date.now()) }).catch(() => {}), 10_000)
  stream.onClosed(() => {
    off()
    clearInterval(ping)
  })
  return stream.send()
})
