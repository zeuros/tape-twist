import { createReadStream } from 'node:fs'

/** The Android app itself (see server/utils/apk.ts). */
export default defineEventHandler(async (event) => {
  const apk = await findApk()
  if (!apk) throw createError({ statusCode: 404, statusMessage: 'No APK built yet' })
  setResponseHeaders(event, {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Length': String(apk.size),
    'Content-Disposition': 'attachment; filename="tape-twist.apk"',
    'Cache-Control': 'no-cache',
  })
  return sendStream(event, createReadStream(apk.path))
})
