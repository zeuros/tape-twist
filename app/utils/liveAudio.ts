import type { StreamOut } from '../workers/mp3Stream'
import { BLOCK } from './pcmBlocks'
import { createScheduler } from './pcmScheduler'
import { ServerClock } from './serverClock'

/**
 * Player for the live MP3 stream, kept in sync with every other listening device.
 *
 * The server says when each sample was rendered on its clock (server/utils/mixer.ts), the
 * page measures the offset between its clock and the server's (like NTP, serverClock.ts), and
 * every device plays sample s at the same server time: anchor + s/SR + delay.
 *
 * A worker fetches the MP3 and decodes it (mpg123 in WebAssembly, pcmBlocks.ts, off the main
 * thread: app/workers/mp3Stream.ts) into 0.1 s blocks, each scheduled with Web Audio at the context time matching its shared server
 * time (pcmScheduler.ts), on every browser. (The browser's own MP3 player, fed through Media
 * Source Extensions, could only be steered from outside: it stuttered on Android when the
 * stream ran late.) `ahead` (seconds, per device) plays this device earlier, for speakers
 * that add their own delay (Bluetooth: 0.1–0.3 s).
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
    if (ts?.performanceTime && ts.contextTime != null) {
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

  // ------------------------------------------------------------ watchdog
  let skippedInRow = 0 // blocks dropped as already over, since the last one played
  let skipped = 0
  let relinked = false // the clock link was measured again for the current run of drops
  let lastCt = ctx.currentTime
  let frozen = 0 // seconds the context's clock stood still while running
  const leads: number[] = [] // margin of the last 5 s of blocks (s between arrival and play)
  const trouble = (why: Trouble) => {
    if (!stopped) onTrouble(why)
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

  const scheduler = createScheduler(ctx, dest, {
    idealTime,
    onUnsynced: () => epoch != null && clock.refresh(),
    onPlaying: opts.onPlaying,
    onBlock: (played, lead) => {
      leads.push(lead)
      if (leads.length > 50) leads.shift()
      if (played) {
        skippedInRow = 0
        relinked = false
      } else {
        skipped++
        skippedInRow++
      }
    },
  })

  const play = (blocks: { l: Float32Array; r: Float32Array; s: number }[]) => {
    for (const { l, r, s } of blocks) {
      if (stopped) return
      const buf = new AudioBuffer({ numberOfChannels: 2, length: BLOCK, sampleRate: 48000 })
      buf.copyToChannel(l as Float32Array<ArrayBuffer>, 0)
      buf.copyToChannel(r as Float32Array<ArrayBuffer>, 1)
      scheduler.push(buf, s)
    }
  }

  const worker = new Worker(new URL('../workers/mp3Stream.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<StreamOut>) => {
    const m = e.data
    if (m.type === 'start') epoch = m.epoch
    else if (m.type === 'blocks') play(m.blocks)
    else trouble('stream')
  }
  worker.onerror = () => trouble('stream')
  worker.postMessage({ url: new URL(url, location.href).href })

  return {
    stop() {
      stopped = true
      clearInterval(watchdog)
      ctx.removeEventListener('statechange', onState)
      clock.stop()
      worker.terminate()
      scheduler.stop()
    },
    lag: () => (clock.info ? clock.info.delay - opts.ahead() : null),
    sync: () => {
      const e = scheduler.lastError()
      return e == null ? null : { errorMs: e * 1000, rttMs: clock.rtt }
    },
    detail: () => {
      // The margin is what's left of SYNC_DELAY once the speaker's delay and the delivery are
      // taken: under 100 ms, any hiccup cuts a block (stutter).
      const ms = (s: number) => Math.round(s * 1000)
      const margin = leads.length ? ms(Math.min(...leads)) : null
      const out = (ctx as AudioContext & { outputLatency?: number }).outputLatency
      return [
        margin == null ? null : `${margin < 100 ? '⚠ ' : ''}margin ${margin} ms`,
        `output ${ms(ctx.baseLatency || 0)}+${out == null ? '?' : ms(out)} ms`,
        `audio ${ctx.state}, ${ctx.sampleRate / 1000} kHz`,
        `${skipped} late blocks dropped`,
      ]
        .filter(Boolean)
        .join(', ')
    },
  }
}
