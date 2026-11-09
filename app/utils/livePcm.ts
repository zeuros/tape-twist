import { MPEGDecoder } from 'mpg123-decoder'
import type { LiveAudio, LiveOptions } from './liveAudio'
import { BLOCK, mp3Reader, pcmReader, type RawBlock } from './pcmBlocks'
import { createScheduler } from './pcmScheduler'
import { ServerClock } from './serverClock'

/**
 * The live stream played with Web Audio, for browsers that can't stream MP3 through MSE
 * (Firefox, iPhones). The MP3 is decoded here (mpg123 in WebAssembly, app/utils/pcmBlocks.ts)
 * into 0.1 s blocks, and each block is scheduled at the context time matching its shared
 * server time (app/utils/pcmScheduler.ts). Without WebAssembly the server's raw PCM is used
 * instead (~1.5 Mbit/s rather than 0.2).
 */
export function playPcm(ctx: AudioContext, dest: AudioNode, url: string, onTrouble: () => void, opts: LiveOptions): LiveAudio {
  const abort = new AbortController()
  const clock = new ServerClock()
  void clock.start()
  let stopped = false
  let epoch: number | null = null
  let decoder: MPEGDecoder | null = null
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

  const scheduler = createScheduler(ctx, dest, {
    idealTime,
    onUnsynced: () => epoch != null && clock.refresh(),
    onPlaying: opts.onPlaying,
  })

  const play = (blocks: RawBlock[]) => {
    for (const { ch, s } of blocks) {
      if (stopped) return
      const buf = new AudioBuffer({ numberOfChannels: 2, length: BLOCK, sampleRate: 48000 })
      buf.copyToChannel(ch[0] as Float32Array<ArrayBuffer>, 0)
      buf.copyToChannel(ch[1] as Float32Array<ArrayBuffer>, 1)
      scheduler.push(buf, s)
    }
  }

  void (async () => {
    try {
      // MP3 unless WebAssembly is missing (or the decoder fails to load): then raw PCM.
      decoder = await loadDecoder()
      if (stopped) return decoder?.free()
      const res = await fetch(decoder ? url : `${url}&format=pcm`, { signal: abort.signal, cache: 'no-store' })
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
      const start = Number(res.headers.get('x-stream-start'))
      epoch = Number(res.headers.get('x-stream-epoch'))
      const read = decoder ? mp3Reader(start, decoder) : pcmReader(start)
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) throw new Error('stream ended')
        play(read(value))
      }
    } catch {
      if (!stopped) onTrouble()
    }
  })()

  return {
    stop() {
      stopped = true
      clock.stop()
      abort.abort()
      scheduler.stop()
      decoder?.free()
    },
    lag: () => (clock.info ? clock.info.delay - opts.ahead() : null),
    sync: () => {
      const e = scheduler.lastError()
      return e == null ? null : { errorMs: e * 1000, rttMs: clock.rtt }
    },
  }
}

/** The MP3 decoder, or null when this browser can't run it. */
async function loadDecoder(): Promise<MPEGDecoder | null> {
  try {
    const d = new MPEGDecoder()
    await d.ready
    return d
  } catch {
    return null
  }
}
