/**
 * Talkover on every device: the voice goes phone → server → the other phones over one WebSocket
 * (/api/voice, server/routes/api/voice.ts), outside the music stream and its 0.55 s sync delay.
 * The socket opens with the booth and stays open, so a press never waits for it; the frames
 * themselves (app/utils/voiceJitter.ts) only flow while someone holds Talkover.
 */

type Sink = (buf: ArrayBuffer) => void

let ws: WebSocket | null = null
let sink: Sink | null = null
let wanted = false
let retry: ReturnType<typeof setTimeout> | undefined
let ping: ReturnType<typeof setInterval> | undefined

function open() {
  const url = new URL('/api/voice', location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const s = (ws = new WebSocket(url))
  s.binaryType = 'arraybuffer'
  s.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) sink?.(e.data)
  }
  s.onclose = () => {
    if (ws !== s) return
    ws = null
    if (wanted) retry = setTimeout(open, 2000)
  }
}

export const voiceLink = {
  /** Open (and keep open) the socket. */
  start() {
    if (wanted) return
    wanted = true
    open()
    ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 15_000) // proxies drop idle sockets
  },
  stop() {
    wanted = false
    clearTimeout(retry)
    clearInterval(ping)
    ws?.close()
    ws = null
  },
  /** A frame of this device's voice (dropped if the socket is down: it's live or nothing). */
  send(buf: ArrayBuffer) {
    if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 16_000) ws.send(buf)
  },
  /** Where the other devices' frames go (null: nowhere). */
  setSink(fn: Sink | null) {
    sink = fn
  },
}
