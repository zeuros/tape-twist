import { booth } from '../utils/booth'

const MAX_BYTES = 2 * 1024 * 1024

// A pad recorded on the booth (raw audio body from MediaRecorder; ?label=name).
export default defineEventHandler(async (event) => {
  if (Number(getRequestHeader(event, 'content-length') || 0) > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'Recording too long' })
  const body = await readRawBody(event, false)
  if (!body?.length) throw createError({ statusCode: 400, statusMessage: 'Empty recording' })
  if (body.length > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'Recording too long' })
  try {
    return await booth.addRecorded(body, String(getQuery(event).label ?? ''))
  } catch (e: any) {
    throw createError({ statusCode: 422, statusMessage: e?.message?.startsWith('Nothing') ? e.message : 'Could not read the recording' })
  }
})
