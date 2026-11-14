/**
 * Reads and decodes the live MP3 stream off the page's main thread (app/utils/liveAudio.ts):
 * on a phone the page's own work (Vue, the booth, the light show) could otherwise hold the
 * blocks back past their play time. Posts the stream's start headers, then every 0.1 s block
 * (its buffers transferred, not copied), or an error when the stream ends or fails.
 */
import { MPEGDecoder } from 'mpg123-decoder'
import { mp3Reader } from '../utils/pcmBlocks'

export type StreamIn = { url: string }
export type StreamOut =
  | { type: 'start'; epoch: number }
  | { type: 'blocks'; blocks: { l: Float32Array; r: Float32Array; s: number }[] }
  | { type: 'error'; message: string }

const post = (m: StreamOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)

self.onmessage = async (e: MessageEvent<StreamIn>) => {
  const decoder = new MPEGDecoder()
  try {
    await decoder.ready
    const res = await fetch(e.data.url, { cache: 'no-store' })
    if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
    post({ type: 'start', epoch: Number(res.headers.get('x-stream-epoch')) })
    const read = mp3Reader(Number(res.headers.get('x-stream-start')), decoder)
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) throw new Error('stream ended')
      const blocks = read(value).map(({ ch, s }) => ({ l: ch[0], r: ch[1], s }))
      if (blocks.length) post({ type: 'blocks', blocks }, blocks.flatMap((b) => (b.l === b.r ? [b.l.buffer] : [b.l.buffer, b.r.buffer])))
    }
  } catch (err) {
    post({ type: 'error', message: (err as Error).message })
  } finally {
    decoder.free()
  }
}
