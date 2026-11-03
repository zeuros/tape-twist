import { enforceRouting, ensureSinks } from './audio'
import { Deck, type DeckState } from './deck'
import { EQ_MIN, mixer } from './mixer'
import { activeList, loadEvening, readJson, writeJson, type FavItem } from './store'

/** Time we allow for loading the next item before its fade must start. */
const PRELOAD_LEAD = 25 // s before the crossfade; a fresh Deezer page takes a few seconds to open
/** Hidden browsers are closed after this long without playback (frees RAM and the Deezer session). */
const CLOSE_DECKS_AFTER = 15 * 60_000

type Status = 'stopped' | 'playing' | 'paused'

export interface EngineSettings {
  crossfade: number
  /** Cut the outgoing bass / bring in the incoming bass at the middle of a crossfade. */
  bassSwap: boolean
  /** Pause after this many hours of continuous playback (0 = never). */
  autoPauseHours: number
  /** Pause when nobody has been listening for this many minutes (0 = never). */
  idlePauseMin: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Plays the evening on two decks and crossfades between them. Every command and the
 * auto-advance run one at a time through `serial`; a manual command interrupts a fade.
 */
class Engine {
  private decks = [new Deck('evening_mix_a'), new Deck('evening_mix_b')]
  private active = 0
  private serial: Promise<unknown> = Promise.resolve()
  private abortFade = false
  private ticking = false
  private timer: ReturnType<typeof setInterval> | null = null
  private ready: Promise<void> | null = null
  /** Next item already loaded (paused, silent) on the idle deck. */
  private preloaded: string | null = null
  private playingSince = 0
  private idleSince = Date.now()
  private lastListenerAt = Date.now()

  status: Status = 'stopped'
  currentId: string | null = null
  adhoc = false
  fading = false
  /** The item being loaded on a deck, until it actually starts playing (a fresh deck takes seconds). */
  loading: FavItem | null = null
  error = ''
  /** Informational message, e.g. why playback was auto-paused. */
  notice = ''
  last: DeckState | null = null
  settings: EngineSettings = { crossfade: 6, bassSwap: true, autoPauseHours: 6, idlePauseMin: 15 }

  private get cur() {
    return this.decks[this.active]
  }
  private get other() {
    return this.decks[1 - this.active]
  }

  private setStatus(s: Status) {
    if (s === 'playing' && this.status !== 'playing') {
      this.playingSince = Date.now()
      this.lastListenerAt = Date.now()
      this.notice = ''
    }
    if (s !== 'playing' && this.status === 'playing') this.idleSince = Date.now()
    this.status = s
  }

  /** Load saved settings early so the UI shows them before anything plays. */
  init() {
    this.ready ??= (async () => {
      await ensureSinks()
      Object.assign(this.settings, await readJson<Partial<EngineSettings>>('engine.json', {}))
      await Promise.all(this.decks.map((d) => d.setVolume(0)))
      this.timer = setInterval(() => {
        this.tick()
        this.reroute()
        this.watchdog()
      }, 500)
    })()
    return this.ready
  }

  /** Run fn after everything queued before it; interrupts a running fade first. */
  private run<T>(fn: () => Promise<T>, interrupt = true): Promise<T> {
    if (interrupt) this.abortFade = true
    const p = this.serial.then(async () => {
      this.abortFade = false
      await this.init()
      return fn()
    })
    this.serial = p.catch((e: Error) => {
      this.error = e.message
      console.error('[engine]', e)
    })
    return p
  }

  private routing = false
  private reroute() {
    if (this.routing) return
    this.routing = true
    enforceRouting()
      .catch(() => {})
      .finally(() => (this.routing = false))
  }
  /** A deck opens its audio stream shortly after play starts: check routing a few times. */
  private rerouteSoon() {
    for (const ms of [100, 300, 700, 1500]) setTimeout(() => this.reroute(), ms)
  }

  private async queue(): Promise<FavItem[]> {
    return activeList(await loadEvening(), this.currentId).items
  }

  private async neighbour(d: 1 | -1): Promise<FavItem | null> {
    if (this.adhoc || !this.currentId) return null
    const q = await this.queue()
    const i = q.findIndex((x) => x.id === this.currentId)
    return i < 0 ? null : q[i + d] ?? null
  }

  // ----------------------------------------------------------- transitions

  /**
   * Make `item` the audible one. With something already playing, fade over `fade` s:
   * a true overlap across decks, or out-then-in when both are Deezer (one stream per account).
   */
  private async switchTo(item: FavItem, fade: number) {
    this.error = ''
    const cur = this.cur
    const audible = this.status === 'playing' && cur.item
    this.fading = true
    this.loading = item
    try {
      if (!audible) {
        await Promise.all(this.decks.map((d) => d.pause()))
        mixer.deckBass(cur.sink, 0)
        await cur.setVolume(1)
        await cur.load(item, true)
        await cur.play() // confirms playback (a fresh Deezer page may ignore autoplay)
        this.rerouteSoon()
        this.loading = null
      } else if (cur.item!.platform === 'deezer' && item.platform === 'deezer') {
        await mixer.ramp([{ sink: cur.sink, to: 0 }], fade / 2, () => this.abortFade)
        await cur.load(item, true)
        await cur.play()
        this.rerouteSoon()
        this.loading = null
        await mixer.ramp([{ sink: cur.sink, to: 1 }], fade / 2, () => this.abortFade)
        await cur.setVolume(1)
      } else {
        const next = this.other
        if (this.preloaded !== item.id) {
          await next.setVolume(0)
          await next.load(item, false)
        }
        // Bass swap: the incoming track comes in without bass; halfway through, the basses
        // trade places, so two kick drums never pile up.
        const swap = this.settings.bassSwap && fade >= 2
        mixer.deckBass(next.sink, swap ? EQ_MIN : 0)
        const swapTimer = swap
          ? setTimeout(() => {
              mixer.deckBass(cur.sink, EQ_MIN)
              mixer.deckBass(next.sink, 0)
            }, (fade * 1000) / 2)
          : undefined
        await next.play()
        this.rerouteSoon()
        this.loading = null
        await mixer.ramp([{ sink: cur.sink, to: 0 }, { sink: next.sink, to: 1 }], fade, () => this.abortFade)
        clearTimeout(swapTimer)
        mixer.deckBass(next.sink, 0)
        await next.setVolume(1)
        await cur.setVolume(0)
        await cur.pause()
        mixer.deckBass(cur.sink, 0)
        this.active = 1 - this.active
      }
      this.currentId = item.id
      this.setStatus('playing')
    } finally {
      this.preloaded = null
      this.fading = false
      this.loading = null
    }
  }

  private async tick() {
    if (this.ticking || this.status !== 'playing' || this.fading) return
    this.ticking = true
    try {
      const s = (this.last = await Promise.race([
        this.cur.state().catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 4000)),
      ]))
      if (!s) return
      const remaining = s.durSec - s.posSec
      const next = await this.neighbour(1)
      const crossfade = this.settings.crossfade
      if (!next) {
        if (s.ended) await this.run(async () => this.stopAll(), false)
        return
      }
      const crossDz = this.cur.item?.platform === 'deezer' && next.platform === 'deezer'
      // Preload the next item silently on the idle deck (not possible Deezer→Deezer).
      if (!crossDz && this.preloaded !== next.id && s.durSec > 0 && remaining <= crossfade + PRELOAD_LEAD) {
        await this.run(async () => {
          await this.other.setVolume(0)
          await this.other.load(next, false)
          this.preloaded = next.id
        }, false)
      }
      const startAt = crossfade > 0 ? crossfade : 0.5
      if (s.ended || (s.durSec > 0 && remaining <= startAt)) {
        await this.run(() => this.switchTo(next, Math.min(crossfade, Math.max(remaining, 0.5))), false)
      }
    } catch (e: any) {
      this.error = e.message
    } finally {
      this.ticking = false
    }
  }

  /** Auto-pause and resource release. */
  private watchdog() {
    const now = Date.now()
    if (mixer.listenerCount > 0) this.lastListenerAt = now
    const { autoPauseHours, idlePauseMin } = this.settings
    if (this.status === 'playing' && !this.fading) {
      if (autoPauseHours > 0 && now - this.playingSince > autoPauseHours * 3600_000) {
        this.pause().then(() => (this.notice = `Auto-paused after ${autoPauseHours} h of playback.`))
      } else if (idlePauseMin > 0 && now - this.lastListenerAt > idlePauseMin * 60_000) {
        this.pause().then(() => (this.notice = `Paused: nobody listened for ${idlePauseMin} min.`))
      }
    } else if (this.status !== 'playing' && now - this.idleSince > CLOSE_DECKS_AFTER && this.decks.some((d) => d.isOpen)) {
      this.run(async () => {
        await Promise.all(this.decks.map((d) => d.close()))
        this.setStatus('stopped')
        this.preloaded = null
      }, false)
    }
  }

  private async stopAll() {
    await Promise.all(this.decks.map(async (d) => {
      await d.pause()
      await d.setVolume(0)
    }))
    this.setStatus('stopped')
    this.preloaded = null
  }

  // --------------------------------------------------------------- commands

  /** Play an evening item by id, or any favorite (ad hoc: stops after it). */
  play(id: string, item?: FavItem) {
    return this.run(async () => {
      const q = await this.queue()
      const target = q.find((x) => x.id === id) ?? item
      if (!target) throw new Error('Item not found')
      this.adhoc = !q.some((x) => x.id === id)
      await this.switchTo(target, Math.min(this.settings.crossfade, 3))
    })
  }

  skip(d: 1 | -1) {
    return this.run(async () => {
      const n = await this.neighbour(d)
      if (n) await this.switchTo(n, Math.min(this.settings.crossfade, 3))
    })
  }

  pause() {
    return this.run(async () => {
      if (this.status !== 'playing') return
      await this.cur.pause()
      this.setStatus('paused')
    })
  }

  resume() {
    return this.run(async () => {
      if (this.status !== 'paused') return
      await this.cur.setVolume(1)
      await this.cur.play()
      this.rerouteSoon()
      this.setStatus('playing')
    })
  }

  seek(sec: number) {
    return this.run(async () => {
      this.preloaded = null
      await this.cur.seek(sec)
    })
  }

  stop() {
    return this.run(() => this.stopAll())
  }

  /**
   * Echo out: cut the current track and bring the next one in. The echo itself is thrown
   * by the listening browsers (they hold the echo send open until the cut reaches them).
   */
  echoOut() {
    return this.run(async () => {
      if (this.status !== 'playing') return
      const cur = this.cur
      const next = await this.neighbour(1)
      await sleep(450)
      await mixer.ramp([{ sink: cur.sink, to: 0 }], 0.25)
      if (next) {
        await sleep(600)
        await this.switchTo(next, 2)
      } else {
        await this.stopAll()
      }
    })
  }

  async setSettings(s: Partial<EngineSettings>) {
    const clamp = (v: unknown, lo: number, hi: number, d: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d
    const cur = this.settings
    this.settings = {
      crossfade: clamp(s.crossfade, 0, 15, cur.crossfade),
      bassSwap: typeof s.bassSwap === 'boolean' ? s.bassSwap : cur.bassSwap,
      autoPauseHours: clamp(s.autoPauseHours, 0, 24, cur.autoPauseHours),
      idlePauseMin: clamp(s.idlePauseMin, 0, 240, cur.idlePauseMin),
    }
    await writeJson('engine.json', this.settings)
  }

  async snapshot() {
    await this.init()
    const cur = this.cur.item
    const next = await this.neighbour(1).catch(() => null)
    return {
      status: this.status,
      fading: this.fading,
      loading: this.loading ? { id: this.loading.id, title: this.loading.title, artist: this.loading.artist, artwork: this.loading.artwork } : null,
      current: cur && this.status !== 'stopped' ? cur : null,
      currentId: this.status !== 'stopped' ? this.currentId : null,
      adhoc: this.adhoc,
      posSec: this.last?.posSec ?? 0,
      durSec: this.last?.durSec ?? cur?.durationSec ?? 0,
      next: next ? { id: next.id, title: next.title, artist: next.artist } : null,
      crossfade: this.settings.crossfade,
      settings: this.settings,
      listeners: mixer.listenerCount,
      error: this.error,
      notice: this.notice,
    }
  }

  debug() {
    return Promise.all(this.decks.map(async (d) => ({ sink: d.sink, vol: mixer.deckVolume(d.sink), ...(await d.debug()) })))
  }

  async shutdown() {
    if (this.timer) clearInterval(this.timer)
    await Promise.all(this.decks.map((d) => d.close()))
  }
}

export const engine = new Engine()
