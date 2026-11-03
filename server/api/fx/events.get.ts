import { booth } from '../../utils/booth'

// Server-sent events: the booth state on connect, then every change and pad hit.
// (A named "ping" event every 15 s keeps proxies and phones from dropping the connection.)
export default defineEventHandler(async (event) => {
  await booth.init()
  const stream = createEventStream(event)
  const send = (data: unknown) => void stream.push(JSON.stringify(data)).catch(() => {})
  send({ type: 'state', state: booth.state })
  const off = booth.subscribe(send)
  const ping = setInterval(() => void stream.push({ event: 'ping', data: '' }).catch(() => {}), 15_000)
  stream.onClosed(() => {
    off()
    clearInterval(ping)
  })
  return stream.send()
})
