/** Whether an Android APK is available to download (/tape-twist.apk). */
export default defineEventHandler(async () => {
  const apk = await findApk()
  return apk ? { available: true, size: apk.size, builtAt: apk.mtime.toISOString() } : { available: false }
})
