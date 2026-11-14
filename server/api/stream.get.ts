import { ensureSinks } from '../utils/audio'
import { mixer } from '../utils/mixer'

// Live MP3 of the mixed decks, decoded and scheduled by each page (app/utils/liveAudio.ts).
export default defineEventHandler(async (event) => {
  await ensureSinks() // the mixer needs the deck sinks to exist before it opens them
  const { out, startSample, epoch } = mixer.addListener()
  setResponseHeaders(event, {
    'content-type': 'audio/mpeg',
    'cache-control': 'no-cache, no-store',
    'x-content-type-options': 'nosniff',
    // Sync (see server/utils/mixer.ts): the sample this stream starts at, on timeline `epoch`.
    'x-stream-start': String(startSample),
    'x-stream-epoch': String(epoch),
  })
  event.node.req.on('close', () => out.destroy())
  return sendStream(event, out)
})
