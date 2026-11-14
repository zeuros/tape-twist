/**
 * Four people messing with the booth at once for a minute (pads, every hold, stutter, XY,
 * colour, EQ, lights, stop/start listening), then checks that every phone is still fine:
 *  - the server let go of every hold at once (no stuck brake/stutter/XY);
 *  - every phone still plays the music, at its normal level, without dropouts (also the
 *    one on a jittery 4G-like link);
 *  - a pad hit on any phone plays on every phone, also a pad added during the evening;
 *  - the light show shows on the phones listening when it's switched on (the one that
 *    switched it on too), and not on a phone that starts listening later.
 *
 * Phones: Chrome (MP3 through MSE), Chrome without MP3 in MSE (the iPhone path: MP3 decoded
 * in the page, Web Audio blocks), Firefox, and Chrome behind a 4G-like link.
 *
 *   npm run test:e2e            (E2E_CHAOS_SEC=20 for a shorter run)
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chromium, firefox, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSinks, INSTRUMENT, jitterProxy, OUT_SINK, type Link, playBeat, sleep, startServer, until, type TestServer } from './harness'

const run = promisify(execFile)
const PORT = 3190
const PROXY_PORT = 3191
const CHAOS_SEC = Number(process.env.E2E_CHAOS_SEC || 60)
const MUSIC = 0
const FX = 1

interface Phone {
  name: string
  page: Page
  /** Plays the MP3 through Media Source Extensions (else: decoded in the page, Web Audio blocks). */
  mse: boolean
  /** Music level before anything happened (Web Audio phones). */
  baseline: number
  streams: number
  errors: string[]
}

let server: TestServer
let proxy: Link
let removeSinks: () => Promise<void>
let beat: ReturnType<typeof playBeat>
const browsers: Browser[] = []
const phones: Phone[] = []

/** Seeded, so a failing run can be replayed (E2E_SEED). */
let seed = Number(process.env.E2E_SEED || Date.now() % 100000)
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

async function openPhone(name: string, browser: Browser, base: string, opts: { pcm?: boolean } = {}): Promise<Phone> {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 1500 } })
  if (browser.browserType().name() === 'chromium') await ctx.grantPermissions(['microphone'], { origin: base })
  await ctx.addInitScript(INSTRUMENT)
  // The iPhone path: no MP3 in Media Source Extensions.
  if (opts.pcm) await ctx.addInitScript(() => (MediaSource.isTypeSupported = () => false))
  const page = await ctx.newPage()
  const phone: Phone = { name, page, mse: false, baseline: 0, streams: 0, errors: [] }
  page.on('request', (r) => r.url().includes('/api/stream') && phone.streams++)
  page.on('pageerror', (e) => phone.errors.push(`pageerror: ${e.message}`))
  await openPlayer(page, base)
  phone.mse = await page.evaluate(() => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg'))
  return phone
}

async function openPlayer(page: Page, base: string) {
  await page.goto(`${base}/player`)
  await page.locator('nav.tabs button', { hasText: 'Booth' }).click()
  await page.locator('.pads .pad').first().waitFor()
}

async function listen(p: Phone) {
  await p.page.locator('button.listen').click()
  await until(`${p.name} listening`, async () => !!(await p.page.locator('button.listen').textContent())?.includes('Listening'), 15_000)
}

const level = (p: Phone, ctx: number, ms: number) =>
  p.page.evaluate(([c, m]) => (window as any).__e2e.level(c, m), [ctx, ms] as const) as Promise<{ min: number; max: number } | null>
const gaps = (p: Phone, ctx: number, ms: number, floor: number) =>
  p.page.evaluate(([c, m, f]) => (window as any).__e2e.gaps(c, m, f), [ctx, ms, floor] as const) as Promise<[number, number][]>

/**
 * How much of its normal music a phone plays over the last `ms`: 1 = all of it, 0 = silence.
 * Web Audio phones: their lowest level against the one before the test. MSE phones: how fast
 * the element plays (Chromium hands Web Audio silence from an MSE element in this setup);
 * their Web Audio graph is the same as the other phones', which hear it.
 */
async function music(p: Phone, ms: number) {
  if (p.mse) return p.page.evaluate((m) => (window as any).__e2e.progress(m) as number, ms)
  return ((await level(p, MUSIC, ms))?.min ?? 0) / p.baseline
}

/** Dropouts over the last `ms`: music below 30 % for ≥ 50 ms, or (MSE) the element freezing or skipping. */
async function dropouts(p: Phone, ms: number) {
  if (!p.mse) return (await gaps(p, MUSIC, ms, p.baseline * 0.3)).filter(([, len]) => len >= 50).map(([at, len]) => `${len} ms silent at +${at} ms`)
  const g = await p.page.evaluate((m) => (window as any).__e2e.glitches(m), ms) as { freezes: [number, number][]; jumps: number }
  return [...g.freezes.map(([at, len]) => `${len} ms frozen at +${at} ms`), ...(g.jumps ? [`${g.jumps} skips`] : [])]
}

/** The booth state the server holds now (the first event of its stream). */
async function serverState() {
  const ac = new AbortController()
  const res = await fetch(`${server.url}/api/fx/events`, { signal: ac.signal })
  const reader = res.body!.getReader()
  let text = ''
  while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value)
  ac.abort()
  return JSON.parse(/data: (.*)/.exec(text)![1]!).state
}

// ------------------------------------------------------------------ gestures (raw mouse, like fingers)

async function box(page: Page, selector: string, i = 0) {
  const el = page.locator(selector).nth(i)
  await el.scrollIntoViewIfNeeded({ timeout: 2000 })
  return (await el.boundingBox())!
}
async function tap(page: Page, selector: string, i = 0) {
  const b = await box(page, selector, i)
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
}
async function hold(page: Page, label: string, ms: number) {
  const holds = page.locator('.hold')
  const i = (await holds.allTextContents()).findIndex((t) => t.includes(label))
  const b = await box(page, '.hold', i)
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await sleep(ms)
  await page.mouse.up()
}
async function drag(page: Page, selector: string, steps: number) {
  const b = await box(page, selector)
  const at = () => [b.x + 4 + rand() * (b.width - 8), b.y + 4 + rand() * (b.height - 8)] as const
  await page.mouse.move(...at())
  await page.mouse.down()
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(...at(), { steps: 3 })
    await sleep(40 + rand() * 250)
  }
  await page.mouse.up()
}

const ACTIONS: [weight: number, name: string, act: (p: Phone) => Promise<unknown>][] = [
  [8, 'pad', async (p) => tap(p.page, '.pads .pad:not(.rec)', Math.floor(rand() * (await p.page.locator('.pads .pad:not(.rec)').count())))],
  [3, 'brake', (p) => hold(p.page, 'Brake', 150 + rand() * 2500)],
  [3, 'rewind', (p) => hold(p.page, 'Rewind', 150 + rand() * 3500)],
  [2, 'build', (p) => hold(p.page, 'Build-up', 300 + rand() * 6000)],
  [2, 'talkover', (p) => hold(p.page, 'Talkover', 300 + rand() * 2500)],
  [3, 'stutter', (p) => drag(p.page, '.stutter-strip', 2 + Math.floor(rand() * 8))],
  [3, 'xy', (p) => drag(p.page, '.xy', 3 + Math.floor(rand() * 10))],
  [1.5, 'colour', (p) => tap(p.page, 'section.booth > .seg:not(.voice-seg) button', Math.floor(rand() * 4))],
  [1.5, 'eq', (p) => p.page.locator('.eq input[type=range]').nth(Math.floor(rand() * 3)).fill(String(Math.round(-26 + rand() * 32)))],
  [0.6, 'lights', (p) => tap(p.page, '.lights-toggle')],
  [0.6, 'stop pads', (p) => tap(p.page, 'button:has-text("Stop pads")')],
  [0.4, 'relisten', async (p) => {
    await tap(p.page, 'button.listen')
    await sleep(300 + rand() * 1500)
    await tap(p.page, 'button.listen')
  }],
]

async function chaos(p: Phone, until: number, log: string[]) {
  const total = ACTIONS.reduce((s, [w]) => s + w, 0)
  while (Date.now() < until) {
    let r = rand() * total
    const [, name, act] = ACTIONS.find(([w]) => (r -= w) < 0) ?? ACTIONS[0]!
    log.push(`${((until - Date.now()) / 1000).toFixed(1)}s left ${p.name}: ${name}`)
    await act(p).catch((e) => log.push(`  ${name} failed: ${String(e.message).split('\n')[0]}`))
    await sleep(rand() * 400)
  }
}

/** Everyone lets go and puts the booth back to clean. */
async function calmDown() {
  for (const p of phones) await p.page.mouse.up().catch(() => {})
  const p = phones[0]!.page
  if ((await p.locator('.lights-toggle').textContent())?.includes('on')) await p.locator('.lights-toggle').click()
  await p.locator('section.booth > .seg:not(.voice-seg) button').first().click()
  await p.locator('h3:has-text("EQ") button.link').click()
  if (await p.locator('button:has-text("Stop pads")').isEnabled()) await p.locator('button:has-text("Stop pads")').click()
  for (const ph of phones) await ph.page.locator('.lightshow').click({ timeout: 500 }).catch(() => {})
  // Anyone who stopped listening listens again.
  for (const ph of phones) {
    if (!(await ph.page.locator('button.listen').textContent())?.includes('Listen here')) continue
    await listen(ph)
  }
}

// ------------------------------------------------------------------ the run

describe('booth: four people messing about', () => {
  beforeAll(async () => {
    removeSinks = await createSinks()
    beat = playBeat()
    server = await startServer(PORT)
    proxy = await jitterProxy(PORT, PROXY_PORT)
    const env = { ...process.env, PULSE_SINK: OUT_SINK }
    // Not muted (Playwright's default): a muted page feeds silence from its media elements into Web Audio.
    const chrome = await chromium.launch({ env, ignoreDefaultArgs: ['--mute-audio'], args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
    const fox = await firefox.launch({
      env,
      firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true, 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 },
    })
    browsers.push(chrome, fox)
    const direct = server.url
    phones.push(
      await openPhone('chrome', chrome, direct),
      await openPhone('iphone-path', chrome, direct, { pcm: true }),
      await openPhone('firefox', fox, direct),
      await openPhone('4g', chrome, `http://127.0.0.1:${PROXY_PORT}`),
    )
    for (const p of phones) await listen(p)
    await sleep(5000) // sync settles
    for (const p of phones) {
      p.baseline = (await level(p, MUSIC, 3000))?.min ?? 0
      if (p.mse) expect(await music(p, 3000), `${p.name} plays the music before anything happens`).toBeGreaterThan(0.9)
      else expect(p.baseline, `${p.name} plays the music before anything happens`).toBeGreaterThan(0.01)
    }
    console.log(`seed ${process.env.E2E_SEED || '(random)'} → replay with E2E_SEED=${seed}`)
  })

  afterAll(async () => {
    for (const b of browsers) await b.close().catch(() => {})
    proxy?.close()
    beat?.kill()
    await server?.stop()
    await removeSinks?.()
    await run('true')
  })

  it(`survives ${CHAOS_SEC} s of four people pressing everything`, async () => {
    const log: string[] = []
    const until = Date.now() + CHAOS_SEC * 1000
    await Promise.all(phones.map((p) => chaos(p, until, log)))
    await calmDown()

    // Nothing stays held on the server once everyone let go (keep-alives arriving late
    // must not switch a hold back on: that freezes everyone's music for 6 s).
    await sleep(1000)
    const s = await serverState()
    expect({ talkover: s.talkover, brake: s.brake, rewind: s.rewind, build: s.build, echo: s.echo, stutter: s.stutter, xy: s.xy }, 'server holds released').toEqual({
      talkover: false, brake: false, rewind: false, build: false, echo: false, stutter: null, xy: null,
    })

    // Every phone back to its music at its normal level within a few seconds.
    await sleep(3000)
    const report: string[] = []
    const heard: number[] = []
    for (const p of phones) {
      heard.push(await music(p, 1500))
      const ctxs = await p.page.evaluate(() => (window as any).__e2e.contexts())
      report.push(`${p.name}: plays ${Math.round(heard.at(-1)! * 100)} % of its music, audio ${ctxs}, ${p.streams} stream connections`)
    }
    console.log(report.join('\n'))
    phones.forEach((p, i) => expect(heard[i], `${p.name} still plays the music after the chaos\n${report.join('\n')}\n${log.slice(-40).join('\n')}`).toBeGreaterThan(0.5))
  })

  it('plays without dropouts once things are calm, also over 4G', async () => {
    await sleep(15_000)
    for (const p of phones) {
      const d = await dropouts(p, 15_000)
      // On 4G the first hiccup after (re)starting may be heard: from then on the phone plays
      // that much later, so the next ones aren't.
      if (p === phones[3]) expect(d.length, `${p.name}: dropouts in 15 s of calm: ${d.join(', ')}`).toBeLessThanOrEqual(1)
      else expect(d, `${p.name}: dropouts in 15 s of calm`).toEqual([])
    }
  })

  it('a pad hit on any phone plays on every phone', async () => {
    for (const from of phones) {
      await sleep(2500) // the previous pad is over
      await tap(from.page, '.pads .pad:not(.rec)', 0)
      await sleep(1200)
      for (const p of phones) {
        const l = await level(p, FX, 1200)
        expect(l?.max ?? 0, `pad from ${from.name} heard on ${p.name}`).toBeGreaterThan(0.01)
      }
      await tap(from.page, 'button:has-text("Stop pads")').catch(() => {})
    }
  })

  it('a pad added during the evening plays on every phone', async () => {
    // A short tone, uploaded like a recorded pad: the same path as a myinstants pad
    // (saved on the server, then every page reloads its pads).
    const { stdout } = await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=880:d=1.5', '-f', 'wav', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 24 })
    const res = await fetch(`${server.url}/api/pads?label=E2E`, { method: 'POST', body: stdout })
    expect(res.ok).toBe(true)
    for (const p of phones) await p.page.locator('.pad', { hasText: 'E2E' }).waitFor({ timeout: 5000 })
    await sleep(2500)
    await tap(phones[1]!.page, '.pad:has-text("E2E")')
    await sleep(1200)
    for (const p of phones) {
      const l = await level(p, FX, 1200)
      expect(l?.max ?? 0, `new pad heard on ${p.name}`).toBeGreaterThan(0.01)
    }
  })

  it('light show: on every listening phone (the initiator too), not on one that joins later', async () => {
    const shown = () => Promise.all(phones.map((p) => p.page.locator('.lightshow').isVisible()))
    expect(await shown(), 'no light show while it is off').toEqual([false, false, false, false])

    await phones[2]!.page.locator('.lights-toggle').click()
    await expect.poll(shown, { timeout: 3000 }).toEqual([true, true, true, true])

    // A phone that loads the page and taps "Listen here" while it's on: no surprise flashing.
    const late = phones[0]!
    await openPlayer(late.page, server.url)
    await listen(late)
    await sleep(1000)
    expect(await late.page.locator('.lightshow').isVisible(), 'light show on a phone that just started listening').toBe(false)

    await phones[2]!.page.locator('.lightshow').click()
    await phones[2]!.page.locator('.lights-toggle').click()
    await expect.poll(shown, { timeout: 3000 }).toEqual([false, false, false, false])
  })

  it('no errors in any page', async () => {
    for (const p of phones) {
      const errors = [...p.errors, ...(await p.page.evaluate(() => (window as any).__e2e.errors as string[]))].filter((e) => !/AbortError|aborted/i.test(e))
      expect(errors, `${p.name} errors`).toEqual([])
    }
  })
})
