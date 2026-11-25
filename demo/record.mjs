/**
 * Records the demo: the Docker server starting in a terminal, then three phones (three Chromium
 * windows at phone size) playing with the same server. Only phone 1 taps "Listen here": its audio
 * (one PulseAudio null sink) is the only sound of the demo.
 *
 *   node demo/record.mjs          → demo/dist/{manifest.json, phone1.mp4, phone2.mp4, phone3.mp4}
 *   (then open demo/index.html, served from the repo root: `npx http-server` or `python3 -m http.server`)
 *
 * Needs Docker (the image built: `docker compose build`), ffmpeg, pactl, espeak-ng (once, for the
 * voice: see demo/work/voice.wav) and the Playwright Chromium. Uses demo/data (a copy of the
 * credentials, pads and certificate), never the real ./data.
 */
import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const run = promisify(execFile)
const ROOT = new URL('..', import.meta.url).pathname
const WORK = `${ROOT}demo/work`
const DIST = `${ROOT}demo/dist`
const BASE = 'https://localhost:3000'
const PIN = '4242'
const QUERY = 'blame the mono dubplate sector'
const COMPOSE = ['compose', '-f', 'docker-compose.yml', '-f', 'demo/docker-compose.demo.yml']
const W = 390
const H = 844

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now()
const seeded = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

// ------------------------------------------------------------------ terminal (the real output, timed)

const term = []
let termStart = 0
const say = (kind, text) => term.push({ t: (now() - termStart) / 1000, kind, text })

async function recordTerminal() {
  await run('docker', [...COMPOSE, 'down'], { cwd: ROOT }).catch(() => {})
  termStart = now()
  say('cmd', 'cd tape-twist')
  await sleep(300)
  say('cmd', 'docker compose up -d')
  const p = spawn('docker', [...COMPOSE, 'up', '-d'], { cwd: ROOT })
  const feed = (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => say('out', l.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')))
  p.stdout.on('data', feed)
  p.stderr.on('data', feed)
  await new Promise((r) => p.on('close', r))
  await sleep(300)
  say('cmd', 'docker compose logs')
  for (let i = 0; i < 90; i++) {
    const { stdout } = await run('docker', [...COMPOSE, 'logs', '--no-log-prefix'], { cwd: ROOT })
    if (stdout.includes('Tape Twist is up')) {
      // The start-up block, with the real addresses.
      const block = stdout.slice(stdout.lastIndexOf('Listening on'))
      block.split('\n').slice(0, 7).forEach((l) => say('out', l))
      break
    }
    await sleep(1000)
  }
  term.duration = (now() - termStart) / 1000
}

// ------------------------------------------------------------------ audio sinks

const sinks = []
async function makeSink(name) {
  const { stdout } = await run('pactl', ['load-module', 'module-null-sink', `sink_name=${name}`, `sink_properties=device.description=${name}`])
  sinks.push(stdout.trim())
}
async function dropSinks() {
  for (const id of sinks) await run('pactl', ['unload-module', id]).catch(() => {})
}

// ------------------------------------------------------------------ phones

const CURSOR = `
addEventListener('DOMContentLoaded', () => {
  const d = document.createElement('div')
  d.style.cssText = 'position:fixed;z-index:2147483647;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:rgba(255,255,255,.45);border:2px solid rgba(255,255,255,.9);pointer-events:none;left:-60px;top:-60px;transition:transform .08s,background .08s'
  document.body.appendChild(d)
  addEventListener('pointermove', (e) => { d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px' }, true)
  addEventListener('pointerdown', (e) => { d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; d.style.transform = 'scale(.7)'; d.style.background = 'rgba(255,170,40,.8)' }, true)
  addEventListener('pointerup', () => { d.style.transform = ''; d.style.background = 'rgba(255,255,255,.45)' }, true)
})`

async function openPhone(n, sink) {
  const browser = await chromium.launch({
    env: { ...process.env, PULSE_SINK: sink },
    ignoreDefaultArgs: ['--mute-audio'],
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${WORK}/voice.wav`,
    ],
  })
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    ignoreHTTPSErrors: true,
    recordVideo: { dir: `${WORK}/video${n}`, size: { width: W, height: H } },
  })
  await ctx.grantPermissions(['microphone'], { origin: BASE })
  await ctx.addInitScript(CURSOR)
  const createdAt = now()
  const page = await ctx.newPage()
  return { n, browser, ctx, page, createdAt, rand: seeded(1000 + n * 77) }
}

async function unlock(p) {
  await p.page.goto(`${BASE}/`)
  await p.page.locator('#pin').fill(PIN)
  await p.page.locator('nav.tabs button').first().waitFor({ timeout: 20_000 })
}
const tab = (p, name) => p.page.locator('nav.tabs button', { hasText: name }).click()

async function box(page, selector, i = 0) {
  const el = page.locator(selector).nth(i)
  // Centre it (not just "in view"): the player bar is fixed at the bottom and would cover it.
  await el.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await sleep(120)
  return await el.boundingBox()
}
async function tap(p, selector, i = 0) {
  const b = await box(p.page, selector, i)
  await p.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 })
  await p.page.mouse.down()
  await sleep(70)
  await p.page.mouse.up()
}
async function hold(p, label, ms) {
  const i = (await p.page.locator('.hold').allTextContents()).findIndex((t) => t.includes(label))
  const b = await box(p.page, '.hold', i)
  await p.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
  await p.page.mouse.down()
  await sleep(ms)
  await p.page.mouse.up()
}

async function holdSel(p, selector, ms) {
  const b = await box(p.page, selector)
  await p.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
  await p.page.mouse.down()
  await sleep(ms)
  await p.page.mouse.up()
}

/** Taps random pads (not the 🎤 recorded ones) until `until` (epoch ms). */
async function pads(p, until) {
  const n = await p.page.locator('.pads .pad:not(.rec)').count()
  await sleep(p.n * 250)
  while (now() < until - 600) {
    await tap(p, '.pads .pad:not(.rec)', Math.floor(p.rand() * n))
    await sleep(350 + p.rand() * 650)
  }
}

/** Slides a finger over a strip (stutter, XY pad) through `points` (fractions of its box). */
async function slide(p, selector, points, msEach) {
  const b = await box(p.page, selector)
  const at = (pt) => {
    const [fx, fy = 0.5] = Array.isArray(pt) ? pt : [pt]
    return [b.x + b.width * fx, b.y + b.height * fy]
  }
  await p.page.mouse.move(...at(points[0]), { steps: 5 })
  await p.page.mouse.down()
  for (const [i, pt] of points.entries()) {
    await p.page.mouse.move(...at(pt), { steps: 18 })
    await sleep(Array.isArray(msEach) ? msEach[i] : msEach)
  }
  await p.page.mouse.up()
}

// ------------------------------------------------------------------ the show

async function main() {
  await rm(WORK + '/video1', { recursive: true, force: true })
  await rm(WORK + '/video2', { recursive: true, force: true })
  await rm(WORK + '/video3', { recursive: true, force: true })
  await rm(DIST, { recursive: true, force: true })
  await mkdir(DIST, { recursive: true })

  for (const n of [1, 2, 3]) await makeSink(`tt_demo_p${n}`)
  console.log('terminal…')
  await recordTerminal()

  console.log('phones…')
  const phones = []
  for (const n of [1, 2, 3]) phones.push(await openPhone(n, `tt_demo_p${n}`))
  const [p1, p2, p3] = phones

  // Phone 1 is the only one that plays sound: record just its sink.
  const wav = `${WORK}/phone1.wav`
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'pulse', '-i', 'tt_demo_p1.monitor', '-ac', '2', '-ar', '48000', wav])
  const audioAt = now()

  // --- Warm-up (cut from the video): the server is up and the song has been playing on it for a
  // while (nobody listens yet, so it is silent), so the decks are hot when the demo starts.
  await Promise.all([unlock(p1), unlock(p2), unlock(p3)])
  await sleep(800)
  await p1.page.locator('input[type=search]').fill(QUERY)
  const trackSel = '[title^="Play Blame The Mono"][title*="Dub"]'
  await p1.page.waitForSelector(trackSel, { timeout: 30_000 })
  const trackTitle = (await p1.page.locator(trackSel).first().getAttribute('title')).replace(/^Play | now$/g, '')
  await p1.page.locator(trackSel).first().click()
  // Pads at half their usual volume.
  await tab(p1, 'Booth')
  await p1.page.locator('label', { hasText: 'Pads volume' }).locator('input').fill('0.4')
  await sleep(500)
  await tab(p1, 'Search')
  console.log('warming up…', trackTitle)
  await sleep(25_000)
  await p1.page.locator('input[type=search]').fill('')

  const T0 = now()
  const scenes = []
  const focusLog = []
  const scene = (name, start, end) => scenes.push({ name, start: (start - T0) / 1000, end: (end - T0) / 1000 })
  const focus = (n) => focusLog.push({ t: (now() - T0) / 1000, phone: n })
  const until = async (t) => sleep(Math.max(0, t - now()))

  // --- Join: phone 1 starts the radio (search, play), then taps "Listen here" to output the sound.
  const introStart = now()
  focus(1)
  await p1.page.locator('input[type=search]').click()
  await p1.page.keyboard.type(QUERY, { delay: 100 })
  await sleep(2500)
  await p1.page.locator(trackSel).first().click()
  await sleep(4500)
  await p1.page.locator('button.listen').click()
  await p1.page.waitForFunction(() => document.querySelector('button.listen')?.textContent?.includes('Listening'), null, { timeout: 20_000 })
  const listenAt = (now() - T0) / 1000
  await sleep(6000)
  focus(2)
  await tab(p2, 'Booth')
  await sleep(2800)
  focus(3)
  await tab(p3, 'Booth')
  await sleep(2800)
  focus(1)
  await tab(p1, 'Booth')
  await sleep(2200)
  const introEnd = now()
  scene('Join', introStart, introEnd)

  const nPads = await p1.page.locator('.pads .pad:not(.rec)').count()

  // --- 1. Pads, 15 s: one phone at a time, each with its own way of tapping.
  const padsEnd = introEnd + 15_000
  scene('Pads', introEnd, padsEnd)
  const padRuns = [[p1, 3, 1700], [p2, 5, 700], [p3, 3, 1300], [p1, 2, 1500], [p2, 3, 900]]
  for (const [p, n, gap] of padRuns) {
    focus(p.n)
    for (let k = 0; k < n && now() < padsEnd - 700; k++) {
      await tap(p, '.pads .pad:not(.rec)', Math.floor(p.rand() * nPads))
      await sleep(gap)
    }
  }
  await until(padsEnd)

  // --- 2. Talkover, 10 s: phone 3 holds the button, nothing else moves.
  const talkStart = now()
  const talkEnd = talkStart + 10_000
  scene('Talkover', talkStart, talkEnd)
  focus(3)
  const talkI = (await p3.page.locator('.hold').allTextContents()).findIndex((t) => t.includes('Talkover'))
  const tb = await box(p3.page, '.hold', talkI)
  await sleep(600)
  await p3.page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 })
  await p3.page.mouse.down()
  await until(talkEnd - 400)
  await p3.page.mouse.up()
  await until(talkEnd)

  // --- 3. Holds, 30 s: one phone at a time, each with its favourites.
  const holdsStart = now()
  const holdsEnd = holdsStart + 30_000
  scene('Holds', holdsStart, holdsEnd)
  const holds = [
    [p1, 'Brake', 1800], [p1, 'Rewind', 1800], [p3, 'Echo throw', 2200], [p3, 'Lights', 2000],
    [p2, 'Flanger', 2400], [p2, '[aria-label="Pitch up"]', 2000], [p1, 'Build-up', 2800], [p3, 'Dub siren', 2000],
    [p2, 'Slow-mo', 2000], [p1, 'Scratch', 2000],
  ]
  for (const [p, what, ms] of holds) {
    if (now() > holdsEnd - 2500) break
    focus(p.n)
    await sleep(350)
    if (what.startsWith('[')) await holdSel(p, what, ms)
    else await hold(p, what, ms)
    await sleep(450)
  }
  await until(holdsEnd)

  // --- 4. Stutter, 10 s, phone 2: 1 beat, then ½, ¼ and ⅛ (about 2 s each).
  const stStart = now()
  const stEnd = stStart + 10_000
  scene('Stutter', stStart, stEnd)
  focus(2)
  await sleep(500)
  await slide(p2, '.stutter-strip', [0.125, 0.375, 0.625, 0.875], [3000, 2000, 2000, 2000])
  await until(stEnd)

  // --- 5. Resonance (XY pad), 15 s: phone 2, then phone 3.
  const xyStart = now()
  const xyEnd = xyStart + 15_000
  scene('Resonance', xyStart, xyEnd)
  focus(2)
  await sleep(500)
  await slide(p2, '.xy', [[0.8, 0.2], [0.55, 0.85], [0.3, 0.5], [0.15, 0.9], [0.1, 0.3]], 1300)
  await sleep(300)
  focus(3)
  await sleep(300)
  await slide(p3, '.xy', [[0.5, 0.1], [0.5, 0.9], [0.2, 0.9], [0.8, 0.9], [0.5, 0.4]], 1300)
  await until(xyEnd)

  // --- 6. Colours, 15 s: phones take turns through the presets.
  const colStart = now()
  const colEnd = colStart + 15_000
  scene('Colours', colStart, colEnd)
  const nCol = await p1.page.locator('section.booth > .seg:not(.voice-seg) button').count()
  const turn = [p3, p1, p2, p3, p1]
  for (let i = 1; i < nCol && now() < colEnd - 1500; i++) {
    const p = turn[i % turn.length]
    focus(p.n)
    await sleep(300)
    await tap(p, 'section.booth > .seg:not(.voice-seg) button', i)
    await sleep(15_000 / (nCol + 1) - 450)
  }
  focus(1)
  await tap(p1, 'section.booth > .seg:not(.voice-seg) button', 0) // back to clean
  await until(colEnd)
  await sleep(1500)
  const end = now()

  // --- Stop and collect.
  ff.kill('SIGINT')
  await new Promise((r) => ff.on('close', r))
  const files = []
  for (const p of phones) {
    const v = await p.page.video().path()
    await p.ctx.close()
    await p.browser.close()
    files.push(v)
  }

  console.log('encoding…')
  const dur = (end - T0) / 1000
  for (const p of phones) {
    const args = ['-y', '-loglevel', 'error', '-ss', String((T0 - p.createdAt) / 1000), '-t', String(dur), '-i', files[p.n - 1]]
    if (p.n === 1) args.push('-ss', String((T0 - audioAt) / 1000), '-t', String(dur), '-i', wav, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '160k')
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-r', '30', '-movflags', '+faststart', `${DIST}/phone${p.n}.mp4`)
    await run('ffmpeg', args)
    // WebM too: Chromium builds without H.264 (and some Linux Firefoxes) only play that one.
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${DIST}/phone${p.n}.mp4`, '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-row-mt', '1', '-deadline', 'realtime', '-cpu-used', '6', '-c:a', 'libopus', `${DIST}/phone${p.n}.webm`])
  }
  await writeFile(`${DIST}/manifest.json`, JSON.stringify({ duration: dur, scenes, terminal: term, terminalDuration: term.duration, track: trackTitle, focus: focusLog, listenAt }, null, 1))
  await writeFile(`${DIST}/manifest.js`, `window.MANIFEST = ${await readFile(`${DIST}/manifest.json`, 'utf8')}\n`) // loadable from file:// (fetch is not)
  console.log('done:', DIST)
}

try {
  await main()
} finally {
  await dropSinks()
  await run('docker', [...COMPOSE, 'down'], { cwd: ROOT }).catch(() => {})
}
