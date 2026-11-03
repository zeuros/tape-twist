import { ensureSinks } from '../utils/audio'
import { mixer } from '../utils/mixer'

// Live MP3 of the mixed decks (?format=pcm: raw s16le stereo 48 kHz, for browsers that
// can't stream MP3 through Media Source Extensions; see app/utils/liveAudio.ts).
export default defineEventHandler(async (event) => {
  await ensureSinks() // the mixer needs the deck sinks to exist before it opens them
  const pcm = getQuery(event).format === 'pcm'
  const { out, startSample, epoch } = mixer.addListener(pcm ? 'pcm' : 'mp3')
  setResponseHeaders(event, {
    'content-type': pcm ? 'application/octet-stream' : 'audio/mpeg',
    'cache-control': 'no-cache, no-store',
    'x-content-type-options': 'nosniff',
    // Sync (see server/utils/mixer.ts): the sample this stream starts at, on timeline `epoch`.
    'x-stream-start': String(startSample),
    'x-stream-epoch': String(epoch),
  })
  event.node.req.on('close', () => out.destroy())
  return sendStream(event, out)
})
