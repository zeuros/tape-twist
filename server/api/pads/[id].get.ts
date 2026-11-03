import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { booth, PADS_DIR } from '../../utils/booth'

// A pad's audio file, for the browsers that play it.
export default defineEventHandler(async (event) => {
  const pad = (await booth.pads()).find((p) => p.id === getRouterParam(event, 'id'))
  if (!pad) throw createError({ statusCode: 404 })
  setResponseHeaders(event, { 'content-type': 'audio/mpeg', 'cache-control': 'max-age=300' })
  return sendStream(event, createReadStream(join(PADS_DIR, pad.file)))
})
