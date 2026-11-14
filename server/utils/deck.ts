import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { deckTag, type SinkName } from './audio'
import { mixer } from './mixer'
import type { FavItem, Platform } from '#shared/types/music'
import { loadCreds } from './store'

export interface DeckState {
  posSec: number
  durSec: number
  playing: boolean
  ended: boolean
}

const SC_DECK_URL = 'https://tape-twist.invalid/deck'
const SC_DECK_HTML = `<!doctype html><html><body>
<div id="host"></div>
<script src="https://w.soundcloud.com/player/api.js"></script>
<script>
let w = null, finished = false, sounds = [], isList = false
const call = (fn) => new Promise((r) => w[fn](r))
function bindAll() {
  w.bind(SC.Widget.Events.FINISH, () => { finished = true })
  w.bind(SC.Widget.Events.PLAY, () => { finished = false })
}
window.deck = {
  async load(url, autoplay, playlist) {
    finished = false; isList = playlist
    if (!w) {
      const f = document.createElement('iframe')
      f.allow = 'autoplay; encrypted-media'; f.width = '600'; f.height = '166'
      f.src = 'https://w.soundcloud.com/player/?visual=false&auto_play=' + autoplay + '&url=' + encodeURIComponent(url)
      document.getElementById('host').appendChild(f)
      w = SC.Widget(f)
      await new Promise((r) => w.bind(SC.Widget.Events.READY, r))
      bindAll()
    } else {
      await new Promise((r) => w.load(url, { auto_play: autoplay, visual: false, callback: r }))
      bindAll()
    }
    sounds = await call('getSounds')
    if (autoplay) w.play()
  },
  play() { w && w.play() },
  pause() { w && w.pause() },
  seek(ms) { w && w.seekTo(ms) },
  async state() {
    if (!w) return null
    const all = Promise.all([call('getPosition'), call('getDuration'), call('isPaused'), call('getCurrentSoundIndex')])
    const r = await Promise.race([all, new Promise((res) => setTimeout(() => res(null), 2000))])
    if (!r) return null
    const [pos, dur, paused, idx] = r
    const before = isList ? sounds.slice(0, idx).reduce((s, x) => s + (x.duration || 0), 0) : 0
    const last = !isList || idx >= sounds.length - 1
    return { pos: before + pos, dur, paused, last, finished: finished && last }
  },
}
</script></body></html>`

/**
 * A deck is a hidden Chromium whose audio goes to its own virtual sink. It keeps one
 * page per platform alive (deezer.com with the captured login, and a SoundCloud widget page).
 */
export class Deck {
  item: FavItem | null = null
  /** The ID Deezer actually plays for the current item (may differ from item.nativeId). */
  private dzSongId: string | null = null
  private browser: Browser | null = null
  private ctx: BrowserContext | null = null
  private pages: Partial<Record<Platform, Page>> = {}
  private platform: Platform | null = null

  /**
   * Deezer syncs player state between every session of an account, so two deck pages
   * on Deezer overwrite each other (one shows a track while playing another's audio).
   * Only one deck keeps a Deezer page at a time.
   */
  private static all: Deck[] = []

  constructor(public readonly sink: SinkName) {
    Deck.all.push(this)
  }

  /** Close this deck's Deezer page (another deck is taking over Deezer). */
  async closeDeezer() {
    const pg = this.pages.deezer
    delete this.pages.deezer
    if (this.platform === 'deezer') {
      this.item = null
      this.platform = null
      this.dzSongId = null
    }
    await pg?.close().catch(() => {})
  }

  get isOpen() {
    return !!this.browser
  }

  private async context() {
    if (this.ctx && this.browser?.isConnected()) return this.ctx
    this.pages = {}
    this.browser = await chromium.launch({
      headless: true,
      channel: 'chromium',
      // PULSE_PROP tags this deck's audio streams so enforceRouting() can find them.
      env: { ...process.env, PULSE_SINK: this.sink, PULSE_PROP: `tape_twist.deck=${deckTag(this.sink)}` },
      // Playwright mutes headless browsers by default.
      ignoreDefaultArgs: ['--mute-audio'],
      args: ['--autoplay-policy=no-user-gesture-required', '--disable-blink-features=AutomationControlled'],
    })
    const ua = (await loadCreds('deezer'))?.userAgent ?? (await loadCreds('soundcloud'))?.userAgent
    this.ctx = await this.browser.newContext({ userAgent: ua, viewport: { width: 1280, height: 800 } })
    await this.ctx.route(SC_DECK_URL, (r) => r.fulfill({ contentType: 'text/html', body: SC_DECK_HTML }))
    return this.ctx
  }

  private async page(p: Platform): Promise<Page> {
    const existing = this.pages[p]
    if (existing && !existing.isClosed()) return existing
    const ctx = await this.context()
    const page = await ctx.newPage()
    if (p === 'deezer') {
      const creds = await loadCreds('deezer')
      if (!creds?.cookies.arl) throw new Error('Deezer is not connected')
      await ctx.addCookies(
        Object.entries(creds.cookies).map(([name, value]) => ({
          name, value, domain: '.deezer.com', path: '/', secure: true, sameSite: 'None' as const,
        })),
      )
      await page.goto('https://www.deezer.com/en/', { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => (window as any).dzPlayer?.control, null, { timeout: 45_000 })
      await page.waitForTimeout(2000) // let the player finish its own startup
    } else {
      await page.goto(SC_DECK_URL)
      await page.waitForFunction(() => (window as any).SC?.Widget, null, { timeout: 30_000 })
    }
    this.pages[p] = page
    return page
  }

  /** Load an item; with autoplay it starts immediately (at the sink's current volume). */
  async load(item: FavItem, autoplay = true) {
    // Silence whatever this deck was playing on the other platform.
    for (const [p, pg] of Object.entries(this.pages)) if (p !== item.platform) await pause(p as Platform, pg)
    if (item.platform === 'deezer') {
      for (const d of Deck.all) if (d !== this && d.pages.deezer) await d.closeDeezer()
    }
    const page = await this.page(item.platform)
    if (item.platform === 'deezer') {
      const knownIds = [item.nativeId, this.item?.id === item.id ? this.dzSongId : null].filter(Boolean)
      const already = await page.evaluate(
        (ids) => ids.includes(String((window as any).dzPlayer.getSongId() ?? '')),
        knownIds as string[],
      )
      if (already) {
        // Already loaded here: rewind instead of reloading. A reload resets the player
        // asynchronously and would swallow a play() sent right after it.
        await page.evaluate((autoplay) => {
          const dz = (window as any).dzPlayer
          dz.control.setVolume(1)
          dz.control.seek(0)
          if (autoplay) dz.control.play()
        }, autoplay)
        this.item = item
        this.platform = item.platform
        return
      }
      await page.evaluate(
        ({ id, autoplay }) => {
          const dz = (window as any).dzPlayer
          dz.control.setVolume(1)
          dz.play({ type: 'track', id, autoplay, context: { ID: id, TYPE: 'track_page', CONTEXT_ID: id } })
        },
        { id: item.nativeId, autoplay },
      )
      // dzPlayer.play resolves before the track is loaded, and Deezer may substitute a
      // newer ID for the same song (e.g. 513734 → 2851583222): match the ID or the title.
      // (A fresh page also restores the account's last-played track, so "ID changed" isn't enough.)
      this.dzSongId = await page
        .waitForFunction(
          ({ id, title }) => {
            const dz = (window as any).dzPlayer
            const s = String(dz.getSongId() ?? '')
            const t = String(dz.getSongTitle() ?? '').toLowerCase()
            if (!s) return null
            return s === id || (t && title.toLowerCase().startsWith(t)) ? s : null
          },
          { id: item.nativeId, title: item.title },
          { timeout: 20_000 },
        )
        .then((h) => h.jsonValue() as Promise<string>)
        .catch(() => {
          throw new Error('Deezer did not load the track (session expired? reconnect Deezer)')
        })
      // Let the player finish switching before anyone sends play/pause.
      await page
        .waitForFunction(() => !(window as any).dzPlayer.isLoading?.(), null, { timeout: 10_000 })
        .catch(() => {})
      await page.waitForTimeout(300)
    } else {
      const url = `https://api.soundcloud.com/${item.kind === 'playlist' ? 'playlists' : 'tracks'}/${item.nativeId}`
      await page.evaluate(({ url, autoplay, pl }) => (window as any).deck.load(url, autoplay, pl), {
        url, autoplay, pl: item.kind === 'playlist',
      })
    }
    this.item = item
    this.platform = item.platform
  }

  async play() {
    const pg = this.platform && this.pages[this.platform]
    if (!pg) return
    if (this.platform === 'soundcloud') {
      await pg.evaluate(() => (window as any).deck.play())
      return
    }
    // Deezer can ignore play() while it is still settling: confirm, and retry.
    for (let i = 0; i < 4; i++) {
      await pg.evaluate(() => (window as any).dzPlayer.control.play())
      const ok = await pg
        .waitForFunction(() => (window as any).dzPlayer.isPlaying(), null, { timeout: 1500 })
        .then(() => true, () => false)
      if (ok) return this.checkDeezerAudio()
    }
    throw new Error('Deezer did not start playing')
  }

  /**
   * The player can show one track while playing another's audio (see Deck.all).
   * Compare the real audio length with the track's listed length; on a mismatch,
   * reload the page and load the track again, once.
   */
  private async checkDeezerAudio(retry = true): Promise<void> {
    const pg = this.pages.deezer
    const item = this.item
    if (!pg || !item) return
    const r = await pg
      .waitForFunction(() => {
        const dz = (window as any).dzPlayer
        const d = dz.getDuration()
        const listed = Number(dz.getCurrentSong?.()?.DURATION) || 0
        return typeof d === 'number' && d > 0 ? { audio: d, listed } : null
      }, null, { timeout: 5000 })
      .then((h) => h.jsonValue() as Promise<{ audio: number; listed: number }>, () => null)
    if (!r || !r.listed || Math.abs(r.audio - r.listed) <= 5) return
    console.warn(`[deck] ${item.title}: Deezer plays ${r.audio.toFixed(0)} s of audio for a ${r.listed} s track, reloading`)
    if (!retry) throw new Error(`Deezer played the wrong audio for "${item.title}"`)
    await this.closeDeezer()
    await this.load(item, false)
    for (let i = 0; i < 4; i++) {
      await this.pages.deezer?.evaluate(() => (window as any).dzPlayer.control.play())
      const ok = await this.pages.deezer
        ?.waitForFunction(() => (window as any).dzPlayer.isPlaying(), null, { timeout: 1500 })
        .then(() => true, () => false)
      if (ok) return this.checkDeezerAudio(false)
    }
  }

  async pause() {
    for (const [p, pg] of Object.entries(this.pages)) await pause(p as Platform, pg)
  }

  async seek(sec: number) {
    const pg = this.platform && this.pages[this.platform]
    if (!pg) return
    if (this.platform === 'deezer') {
      await pg.evaluate((s) => {
        const dz = (window as any).dzPlayer
        const d = dz.getDuration()
        if (d > 0) dz.control.seek(Math.max(0, Math.min(0.999, s / d)))
      }, sec)
    } else {
      await pg.evaluate((ms) => (window as any).deck.seek(ms), Math.round(sec * 1000))
    }
  }

  async state(): Promise<DeckState | null> {
    const pg = this.platform && this.pages[this.platform]
    if (!pg || !this.item) return null
    if (this.platform === 'deezer') {
      const s = await pg.evaluate((id) => {
        const dz = (window as any).dzPlayer
        return { pos: Number(dz.getPosition()) || 0, dur: Number(dz.getDuration()) || 0, playing: !!dz.isPlaying(), same: String(dz.getSongId()) === id }
      }, this.dzSongId ?? this.item.nativeId)
      // Deezer may roll on to a recommendation after our track: treat that as the end.
      const ended = !s.same || (!s.playing && s.dur > 0 && s.pos >= s.dur - 1)
      return { posSec: s.pos, durSec: s.dur || this.item.durationSec, playing: s.playing && s.same, ended }
    }
    const s = await pg.evaluate(() => (window as any).deck.state())
    if (!s) return null
    const durSec = this.item.kind === 'playlist' ? this.item.durationSec : s.dur / 1000
    return { posSec: s.pos / 1000, durSec, playing: !s.paused, ended: s.finished }
  }

  /** Diagnostics: raw player state of every page in this deck. */
  async debug() {
    const out: Record<string, unknown> = { item: this.item?.title, platform: this.platform, dzSongId: this.dzSongId }
    for (const [p, pg] of Object.entries(this.pages)) {
      out[p] = await pg
        .evaluate((p) => {
          if (p === 'deezer') {
            const dz = (window as any).dzPlayer
            return { id: dz.getSongId(), title: dz.getSongTitle(), playing: dz.isPlaying(), paused: dz.isPaused(), loading: dz.isLoading?.(), pos: dz.getPosition(), dur: dz.getDuration(), vol: dz.getVolume(), muted: dz.isMuted(), type: dz.getPlayerType?.(), limited: dz.isLimited?.() }
          }
          return (window as any).deck.state()
        }, p)
        .catch((e: Error) => 'ERR ' + e.message)
    }
    return out
  }

  async setVolume(v: number) {
    mixer.setDeckVolume(this.sink, v)
  }

  async close() {
    await this.browser?.close().catch(() => {})
    this.browser = null
    this.ctx = null
    this.pages = {}
    this.item = null
    this.platform = null
  }
}

async function pause(p: Platform, page: Page) {
  if (page.isClosed()) return
  await page
    .evaluate((p) => {
      if (p === 'deezer') {
        const dz = (window as any).dzPlayer
        if (dz?.isPlaying()) dz.control.pause()
      } else (window as any).deck?.pause()
    }, p)
    .catch(() => {})
}
