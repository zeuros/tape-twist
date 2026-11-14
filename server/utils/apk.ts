import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DATA_DIR } from './store'

/**
 * The Android app offered in the player: data/tape-twist.apk (`npm run android:apk` copies it
 * there), else the last debug build straight from the Android project.
 */
const CANDIDATES = [join(DATA_DIR, 'tape-twist.apk'), resolve('android/app/build/outputs/apk/debug/app-debug.apk')]

export async function findApk() {
  for (const path of CANDIDATES) {
    const s = await stat(path).catch(() => null)
    if (s?.isFile()) return { path, size: s.size, mtime: s.mtime }
  }
  return null
}
