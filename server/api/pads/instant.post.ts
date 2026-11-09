import { booth } from '../../utils/booth'

// A pad from a myinstants.com link ({ url }): the server downloads the sound.
export default defineEventHandler(async (event) => {
  const { url } = (await readBody<{ url?: string }>(event)) ?? {}
  if (!url) throw createError({ statusCode: 400, statusMessage: 'No link' })
  try {
    return await booth.addInstant(String(url))
  } catch (e: any) {
    console.error('[pads] myinstants', url, e)
    throw createError({ statusCode: 422, statusMessage: e?.message || 'Could not add that sound' })
  }
})
