import { mixer } from '../utils/mixer'

// Server clock and stream timeline, for the phones to play in sync (app/utils/liveAudio.ts).
export default defineEventHandler((event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  return mixer.clock
})
