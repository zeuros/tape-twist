import type { LiveStats } from './livePlayerCore'
import { ServerClock } from './serverClock'
import type { FromPlayer, ToPlayer } from '../workers/livePlayer.worklet'
import type { StreamIn, StreamOut } from '../workers/mp3Stream'
import workletUrl from '../workers/livePlayer.worklet.ts?worker&url'

/**
 * Player for the live MP3 stream, kept in sync with every other listening device.
 *
 * The server says when each sample was rendered on its clock (server/utils/mixer.ts), the
 * page measures the offset between its clock and the server's (like NTP, serverClock.ts), and
 * every device plays sample s at the same server time: anchor + s/SR + delay.
 *
 * The page's main thread is out of the audio path: a worker fetches the MP3 and decodes it
 * (mpg123 in WebAssembly, app/workers/mp3Stream.ts) and hands the 0.1 s blocks straight to an
 * AudioWorklet (app/workers/livePlayer.worklet.ts) that plays them as one continuous stream,
 * steered to where the page says it should be (livePlayerCore.ts). (Before: a Web Audio source
 * per block, scheduled from the page, whose late blocks lost their start; before that, the
 * browser's own MP3 player through Media Source Extensions, which could only be steered from
 * outside.) `ahead` (seconds, per device) plays this device earlier, for speakers that add
 * their own delay (Bluetooth: 0.1–0.3 s).
 *
 * A watchdog keeps it audible: a suspended context is resumed; when every block arrives already
 * over (the context/server clock link went wrong) the link is measured again; and when that
 * doesn't help, or the context's clock stands still while "running" (its output died, Firefox
 * on Android after an output change), it reports 'dead' so the page rebuilds the context.
 */
export interface SyncInfo {
  /** Last measured error, in ms (positive: this device is late). */
  errorMs: number
  /** Round trip of the best clock probe, in ms (sync precision is about half of it). */
  rttMs: number
}

export interface LiveAudio {
  stop(): void
  /** Current delay behind the server, in seconds (null while unknown). */
  lag(): number | null
  /** Sync state, or null while not synced. */
  sync(): SyncInfo | null
  /** Health of the audio path, for the sync note's tooltip. */
  detail(): string
}

export interface LiveOptions {
  /** Called when sound starts. */
  onPlaying?: () => void
  /** Seconds this device plays earlier than the others (its speaker's own delay). */
  ahead: () => number
}

/** Why a stream gave up. 'dead': the audio context itself is broken, rebuild it before retrying. */
export type Trouble = 'stream' | 'dead'

export function playLive(ctx: AudioContext, dest: AudioNode, url: string, onTrouble: (why: Trouble) => void, opts: LiveOptions): LiveAudio {
  const clock = new ServerClock()
  void clock.start()
  let stopped = false
  let epoch: number | null = null
  const mapping: number[] = [] // recent (performance ms − context ms) readings
  let lastMapAt = -Infinity

  /** Context time at which stream sample `s` should be heard, or null while unknown. */
  const idealTime = (s: number) => {
    const c = clock.info
    if (clock.offset == null || !c || c.anchor == null || c.epoch !== epoch) return null
    const serverMs = c.anchor + (s / c.sr) * 1000 + (c.delay - opts.ahead()) * 1000
    const perfMs = serverMs - clock.offset
    const ts = ctx.getOutputTimestamp?.()
    // getOutputTimestamp tells what is at the speaker now, so output latency is included.
    // Its context time only moves once per audio callback (a ±20 ms sawtooth in Firefox),
    // so the true link between the two clocks is the lowest reading of the last seconds.
    // Before its output really runs, a context's timestamps are bogus (Firefox: they would hold
    // the minimum for seconds): only read them once its clock has moved.
    if (ts?.performanceTime && ts.contextTime && ctx.state === 'running') {
      if (ts.performanceTime - lastMapAt > 50) {
        lastMapAt = ts.performanceTime
        mapping.push(ts.performanceTime - ts.contextTime * 1000)
        if (mapping.length > 60) mapping.shift()
      }
      return (perfMs - Math.min(...mapping)) / 1000
    }
    const c2 = ctx as AudioContext & { outputLatency?: number }
    return ctx.currentTime + (perfMs - performance.now()) / 1000 - (c2.outputLatency || 0) - (ctx.baseLatency || 0)
  }

  // ------------------------------------------------------------ player
  const worker = new Worker(new URL('../workers/mp3Stream.ts', import.meta.url), { type: 'module' })
  const blocks = new MessageChannel() // worker → worklet, past this thread
  let node: AudioWorkletNode | null = null
  const toPlayer = (m: ToPlayer) => node?.port.postMessage(m, m.type === 'blocks-port' ? [m.port] : [])
  let streamStart: number | null = null
  let stats: LiveStats | null = null
  let synced = false

  void (async () => {
    try {
      await addPlayerModule(ctx)
      if (stopped) return
      node = new AudioWorkletNode(ctx, 'live-player', { numberOfInputs: 0, outputChannelCount: [2] })
      node.connect(dest)
      node.port.onmessage = (e: MessageEvent<FromPlayer>) => {
        if (e.data.type === 'playing') opts.onPlaying?.()
        else onStats(e.data)
      }
      toPlayer({ type: 'blocks-port', port: blocks.port2 })
      worker.postMessage({ url: new URL(url, location.href).href, port: blocks.port1 } satisfies StreamIn, [blocks.port1])
    } catch {
      trouble('stream')
    }
  })()
  worker.onmessage = (e: MessageEvent<StreamOut>) => {
    const m = e.data
    if (m.type === 'start') {
      epoch = m.epoch
      streamStart = m.start
      sendMap()
    } else trouble('stream')
  }
  worker.onerror = () => trouble('stream')

  /** Tells the worklet where the stream should be (it steers there by itself between two). */
  const sendMap = () => {
    if (stopped || epoch == null) return
    const s0 = stats?.pos || streamStart || 0
    const t0 = idealTime(s0)
    if (t0 != null) {
      synced = true
      return toPlayer({ type: 'map', s0, t0 })
    }
    if (synced) toPlayer({ type: 'unmap' })
    synced = false
    clock.refresh()
  }
  const mapTimer = setInterval(sendMap, 100)

  // ------------------------------------------------------------ watchdog
  let skippedInRow = 0 // blocks dropped as already over, since the last one played
  let skipped = 0
  let starved = 0 // output frames with nothing to play (gaps)
  let jumps = 0
  let relinked = false // the clock link was measured again for the current run of drops
  let lastCt = ctx.currentTime
  let frozen = 0 // seconds the context's clock stood still while running
  const leads: number[] = [] // margin of the last 5 s of blocks (s between arrival and play)
  function trouble(why: Trouble) {
    if (!stopped) onTrouble(why)
  }
  function onStats(s: LiveStats) {
    stats = s
    leads.push(...s.leads)
    leads.splice(0, Math.max(0, leads.length - 50))
    skipped += s.late
    starved += s.starved
    jumps += s.jumps
    if (s.played) {
      skippedInRow = 0
      relinked = false
    } else skippedInRow += s.late
  }
  const onState = () => {
    mapping.length = 0 // its clock may have jumped
    if (!stopped && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => {})
  }
  ctx.addEventListener('statechange', onState)
  const watchdog = setInterval(() => {
    if (stopped) return
    if (ctx.state !== 'running') return onState()
    frozen = ctx.currentTime === lastCt ? frozen + 1 : 0
    lastCt = ctx.currentTime
    if (frozen >= 3) return trouble('dead')
    if (skippedInRow >= 20) {
      // 2 s of audio dropped in a row: measure the link again once, then give up on this context.
      if (relinked) return trouble('dead')
      relinked = true
      skippedInRow = 0
      mapping.length = 0
    }
  }, 1000)

  return {
    stop() {
      stopped = true
      clearInterval(watchdog)
      clearInterval(mapTimer)
      ctx.removeEventListener('statechange', onState)
      clock.stop()
      worker.terminate()
      toPlayer({ type: 'stop' })
      node?.disconnect()
    },
    lag: () => (clock.info ? clock.info.delay - opts.ahead() : null),
    sync: () => {
      const e = stats?.err
      return e == null ? null : { errorMs: e * 1000, rttMs: clock.rtt }
    },
    detail: () => {
      // The margin is what's left of SYNC_DELAY once the speaker's delay and the delivery are
      // taken: under 100 ms, any hiccup leaves a gap (stutter).
      const ms = (s: number) => Math.round(s * 1000)
      const margin = leads.length ? ms(Math.min(...leads)) : null
      const out = (ctx as AudioContext & { outputLatency?: number }).outputLatency
      return [
        margin == null ? null : `${margin < 100 ? '⚠ ' : ''}margin ${margin} ms`,
        `output ${ms(ctx.baseLatency || 0)}+${out == null ? '?' : ms(out)} ms`,
        `audio ${ctx.state}, ${ctx.sampleRate / 1000} kHz`,
        `${skipped} late blocks dropped, ${ms(starved / ctx.sampleRate)} ms of gaps, ${jumps} jumps`,
      ]
        .filter(Boolean)
        .join(', ')
    },
  }
}

/** The worklet's module, loaded once per context. */
const loaded = new WeakMap<BaseAudioContext, Promise<void>>()
function addPlayerModule(ctx: BaseAudioContext) {
  let p = loaded.get(ctx)
  if (!p) loaded.set(ctx, (p = ctx.audioWorklet.addModule(workletUrl)))
  return p
}
