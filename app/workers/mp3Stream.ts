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

self.onmessage = async (e: MessageEvent<StreamIn>) => {
  const { url, port } = e.data
  const decoder = new MPEGDecoder()
  try {
    await decoder.ready
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
    const start = Number(res.headers.get('x-stream-start'))
    post({ type: 'start', epoch: Number(res.headers.get('x-stream-epoch')), start })
    const read = mp3Reader(start, decoder)
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) throw new Error('stream ended')
      const blocks: LiveBlock[] = read(value).map(({ ch, s }) => ({ l: ch[0], r: ch[1], s }))
      if (blocks.length) port.postMessage(blocks, blocks.flatMap((b) => (b.l === b.r ? [b.l.buffer] : [b.l.buffer, b.r.buffer])))
    }
  } catch (err) {
    post({ type: 'error', message: (err as Error).message })
  } finally {
    decoder.free()
  }
}
