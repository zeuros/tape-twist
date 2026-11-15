/**
 * Reads and decodes the live MP3 stream off the page's main thread: on a phone the page's own
 * work (Vue, the booth, the light show) could otherwise hold the blocks back past their play
 * time. The 0.1 s blocks go straight to the player's AudioWorklet over the port it's given
 * (their buffers transferred, not copied); the page only hears of the stream's start and end.
 */
import { MPEGDecoder } from 'mpg123-decoder'
import { mp3Reader } from '../utils/pcmBlocks'
import type { LiveBlock } from '../utils/livePlayerCore'

export type StreamIn = { url: string; port: MessagePort }
export type StreamOut = { type: 'start'; epoch: number; start: number } | { type: 'error'; message: string }

const post = (m: StreamOut) => (self as unknown as Worker).postMessage(m)
/** The server sends without pause (silence too): this long with nothing means the stream is dead. */
const SILENT_MS = 5000

self.onmessage = async (e: MessageEvent<StreamIn>) => {
  const { url, port } = e.data
  const decoder = new MPEGDecoder()
  const controller = new AbortController()
  try {
    await decoder.ready
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
    const start = Number(res.headers.get('x-stream-start'))
    post({ type: 'start', epoch: Number(res.headers.get('x-stream-epoch')), start })
    const read = mp3Reader(start, decoder)
    const reader = res.body.getReader()
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const stalled = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('stream stalled')), SILENT_MS)
      })
      const { done, value } = await Promise.race([reader.read(), stalled]).finally(() => clearTimeout(timer))
      if (done) throw new Error('stream ended')
      const blocks: LiveBlock[] = read(value).map(({ ch, s }) => ({ l: ch[0], r: ch[1], s }))
      if (blocks.length) port.postMessage(blocks, blocks.flatMap((b) => (b.l === b.r ? [b.l.buffer] : [b.l.buffer, b.r.buffer])))
    }
  } catch (err) {
    controller.abort() // a stalled connection: let it go
    post({ type: 'error', message: (err as Error).message })
  } finally {
    decoder.free()
  }
}
