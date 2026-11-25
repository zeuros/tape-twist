/**
 * Records demo/index.html (?rec layout) as a 1920x1080 video with its sound:
 *   node demo/record-video.mjs [out.mp4]      → demo/dist/mash-that-sound-up-1080p.mp4
 * Frames come from Playwright's screencast, the sound from a PulseAudio null sink the page plays
 * into; one ffmpeg stamps both with the wall clock, so they stay in sync. Run `node demo/record.mjs`
 * first (it makes demo/dist/phone*.mp4 and manifest.js).
 */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const run = promisify(execFile)
const ROOT = new URL('..', import.meta.url).pathname
const OUT = process.argv[2] || `${ROOT}demo/dist/mash-that-sound-up-1080p.mp4`
const SINK = 'tt_demo_video'
const W = 1920
const H = 1080
const FPS = 30
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { stdout: moduleId } = await run('pactl', ['load-module', 'module-null-sink', `sink_name=${SINK}`])
let browser, ff
try {
  browser = await chromium.launch({
    env: { ...process.env, PULSE_SINK: SINK },
    ignoreDefaultArgs: ['--mute-audio'],
    args: ['--autoplay-policy=no-user-gesture-required', '--force-device-scale-factor=1', '--hide-scrollbars'],
  })
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage()
  await page.goto(`file://${ROOT}demo/index.html?rec`)
  await page.waitForFunction(() => window.__ready, null, { timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
  await sleep(1000)
  const duration = await page.evaluate(() => total())

  // One ffmpeg: JPEG frames from the screencast + the sink's monitor, both on the wall clock.
  ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-use_wallclock_as_timestamps', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-i', '-',
    '-f', 'pulse', '-i', `${SINK}.monitor`,
    '-vf', `fps=${FPS},scale=${W}:${H}:flags=lanczos,format=yuv420p`,
    '-af', 'aresample=async=1:first_pts=0',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', OUT,
  ], { stdio: ['pipe', 'inherit', 'inherit'] })
  ff.stdin.on('error', () => {})
  await page.screencast.start({ size: { width: W, height: H }, quality: 95, onFrame: ({ data }) => ff.stdin.write(data) })
  await sleep(800)
  await page.evaluate(() => setPlaying(true))
  console.log(`recording ${Math.round(duration)} s…`)
  const t0 = Date.now()
  const tick = setInterval(async () => console.log(`  ${Math.round((Date.now() - t0) / 1000)} s, page clock`, Math.round(await page.evaluate(() => clock).catch(() => -1))), 20_000)
  await page.waitForFunction(() => window.__done, null, { timeout: (duration + 60) * 1000, polling: 500 })
  clearInterval(tick)
  console.log('page finished, closing')
  await sleep(1500)
  await Promise.race([page.screencast.stop().catch(() => {}), sleep(5000)])
  // The sound input never ends by itself: SIGINT makes ffmpeg stop and finish the file properly.
  ff.stdin.end() // no more frames (else ffmpeg stays blocked reading them and never sees the signal)
  ff.kill('SIGINT')
  await new Promise((r) => ff.on('close', r))
  console.log('done:', OUT)
} finally {
  await browser?.close()
  await run('pactl', ['unload-module', moduleId.trim()]).catch(() => {})
}
