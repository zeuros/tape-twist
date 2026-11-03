import { spawn, type ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import {
  AudioContext,
  BiquadFilterNode,
  ChannelMergerNode,
  ChannelSplitterNode,
  GainNode,
  ScriptProcessorNode,
  WaveShaperNode,
} from 'node-web-audio-api'
import { SINKS, type SinkName } from './audio'

/**
 * Live mixer, a Web Audio graph rendered natively (node-web-audio-api, Rust):
 *
 *   ffmpeg (both deck sinks, 4ch f32) ─▶ FIFO ─▶ [in] script processor
 *     ─▶ per deck: bass shelf (bass swap) ─▶ gain (crossfades) ─▶ sum ─▶ soft limiter
 *     ─▶ [out] script processor ─▶ ffmpeg (MP3) ─▶ listeners
 *
 * Script processors, not AudioWorklets: this library's worklet thread busy-polls a whole
 * CPU core. Their callbacks run on the main thread every 43 ms, which is cheap.
 *
 * Deck volumes and crossfade curves live here as AudioParams (sample-accurate ramps);
 * the PipeWire sinks themselves stay at 100 %.
 * The booth effects (pads, colour, echo, talkover, EQ) are applied by each listening
 * browser instead (app/utils/boothAudio.ts), so they're instant on the device you press.
 *
 * Sync: the MP3 is constant bitrate (192k at 48 kHz: every frame is exactly 576 bytes and
 * 1152 samples), so a byte offset in the stream is a sample position. The server notes when
 * each sample was rendered (`anchor` + sample / SR, on its clock), every listener is told
 * the sample its stream starts at, and each phone plays sample s at anchor + s/SR + SYNC_DELAY
 * on the server's clock (app/utils/liveAudio.ts). All phones then play the same instant.
 */

export const SR = 48000
/** EQ slider bottom: a kill (-40 dB), DJ-style. */
export const EQ_MIN = -26

const BUF = 2048 // frames per script-processor callback (43 ms): tolerates main-thread hiccups
const RING = 65536 // frames per input channel ring (1.37 s, power of 2)
const PREFILL = BUF + 2400 // frames queued before the input starts (jitter cover)
const STALL_MS = 2000 // no render callback for this long while capturing: the graph is stuck
const MAX_QUEUE = BUF + 14400 // past this, skip ahead to PREFILL (clock drift, stalls)

/** How far behind the server every synced phone plays (covers Wi-Fi hiccups). */
export const SYNC_DELAY = 1.2
const FRAME_BYTES = 576 // 192 kbit/s, 48 kHz, MPEG-1 layer III: no padding ever
const FRAME_SAMPLES = 1152
const BACKLOG_BYTES = 24_000 * 4 // last 4 s of MP3, so a new listener starts in sync at once
const PCM_BACKLOG_BLOCKS = Math.ceil((3 * SR) / BUF) // 3 s of raw audio for a new PCM listener
// A listener this far behind (8 s) is dropped; it reconnects.
const MAX_PENDING = { mp3: 24_000 * 8, pcm: SR * 4 * 8 }
type StreamKind = 'mp3' | 'pcm'
const ANCHOR_WINDOW = 120 // callbacks (~5 s) over which the earliest timing wins

/** Server clock in ms, sub-millisecond (what /api/clock reports). */
export const nowMs = () => performance.timeOrigin + performance.now()

/** Transparent below 0.9, soft-saturates above, never exceeds 1 (input pre-scaled by 0.5). */
const dbToGain = (db: number) => Math.pow(10, db / 20)

function limiterCurve() {
  const n = 4097
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2 // curve spans input -2..2
    const a = Math.abs(x)
    c[i] = a > 0.9 ? Math.sign(x) * (0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1)) : x
  }
  return c
}

/** A deck gain ramp, tracked on the wall clock so it survives the graph being torn down. */
interface Ramp {
  from: number
  to: number
  t0: number
  dur: number
}

const shape = (r: Ramp, k: number) =>
  r.to > r.from ? Math.sin((k * Math.PI) / 2) : 1 - Math.cos((k * Math.PI) / 2)
const rampValue = (r: Ramp, now = performance.now()) => {
  const k = r.dur > 0 ? Math.min(1, Math.max(0, (now - r.t0) / r.dur)) : 1
  return r.from + (r.to - r.from) * shape(r, k)
}

interface Graph {
  ctx: AudioContext
  bass: BiquadFilterNode[]
  trim: GainNode[]
  gain: GainNode[]
  fifo: Float32Array[] // planar, one per capture channel
  w: number
  r: number
  primed: boolean
  /** Last render callback (performance.now()), for the stall watchdog. */
  lastRender: number
}

class Mixer {
  private gains: Ramp[] = SINKS.map(() => ({ from: 0, to: 0, t0: 0, dur: 0 }))
  private bassDb = SINKS.map(() => 0)
  /** Per-deck level trim (dB): evens out the platforms' loudness (Deezer plays quieter). */
  private trimDb = SINKS.map(() => 0)

  private graph: Graph | null = null
  private capture: ChildProcess | null = null
  private encoder: ChildProcess | null = null
  private listeners = new Map<PassThrough, StreamKind>()
  private stopTimer: ReturnType<typeof setTimeout> | undefined
  private rest = Buffer.alloc(0)
  // Sync timeline (reset when the encoder restarts; `epoch` tells the phones).
  private epoch = 0
  private samples = 0
  private bytesOut = 0
  private backlog: Buffer[] = []
  private pcmBacklog: { start: number; data: Buffer }[] = []
  private backlogStart = 0
  private anchors: number[] = []
  private anchorMs: number | null = null

  // ------------------------------------------------------------ deck controls

  /** Current amplitude gain of a deck (0..1). */
  deckVolume(deck: SinkName) {
    return rampValue(this.gains[SINKS.indexOf(deck)]!)
  }

  /** Set a deck's gain at once. */
  setDeckVolume(deck: SinkName, gain: number) {
    const d = SINKS.indexOf(deck)
    const g = Math.max(0, Math.min(1, gain))
    this.gains[d] = { from: g, to: g, t0: 0, dur: 0 }
    const p = this.graph?.gain[d]!.gain
    if (p && this.graph) {
      const t = this.graph.ctx.currentTime
      p.cancelScheduledValues(t)
      p.setValueAtTime(g, t)
    }
  }

  /**
   * Ramp several decks at once over `seconds` with equal-power curves (sin in, cos out),
   * so a crossfade keeps a steady loudness instead of dipping in the middle.
   * Resolves true when done, false if `abort()` turned true on the way (gains hold there).
   */
  async ramp(targets: { sink: SinkName; to: number }[], seconds: number, abort?: () => boolean) {
    const t0 = performance.now()
    const dur = seconds * 1000
    for (const t of targets) {
      const d = SINKS.indexOf(t.sink)
      const r: Ramp = { from: rampValue(this.gains[d]!, t0), to: Math.max(0, Math.min(1, t.to)), t0, dur }
      this.gains[d] = r
      this.scheduleRamp(d, r)
    }
    while (performance.now() - t0 < dur) {
      if (abort?.()) {
        for (const t of targets) this.setDeckVolume(t.sink, this.deckVolume(t.sink))
        return false
      }
      await new Promise((res) => setTimeout(res, Math.min(50, dur - (performance.now() - t0) + 1)))
    }
    for (const t of targets) this.setDeckVolume(t.sink, t.to)
    return true
  }

  private scheduleRamp(d: number, r: Ramp) {
    if (!this.graph) return
    const p = this.graph.gain[d]!.gain
    const now = this.graph.ctx.currentTime
    const left = (r.dur - (performance.now() - r.t0)) / 1000
    p.cancelScheduledValues(now)
    if (left <= 0.01 || r.from === r.to) {
      p.setValueAtTime(r.to, now)
      return
    }
    const n = 64
    const curve = new Float32Array(n)
    const tStart = performance.now()
    for (let i = 0; i < n; i++) curve[i] = rampValue(r, tStart + (i / (n - 1)) * left * 1000)
    p.setValueCurveAtTime(curve, now, left)
  }

  /** Per-deck low-band level (dB), used by the engine for bass swaps. */
  deckBass(deck: SinkName, db: number) {
    const d = SINKS.indexOf(deck)
    this.bassDb[d] = db <= EQ_MIN ? -40 : db
    if (this.graph) this.graph.bass[d]!.gain.setTargetAtTime(this.bassDb[d]!, this.graph.ctx.currentTime, 0.025)
  }

  /** Per-deck level trim (dB), set from the platform the deck plays. */
  deckTrim(deck: SinkName, db: number) {
    const d = SINKS.indexOf(deck)
    if (this.trimDb[d] === db) return
    this.trimDb[d] = db
    if (this.graph) this.graph.trim[d]!.gain.setTargetAtTime(dbToGain(db), this.graph.ctx.currentTime, 0.05)
  }

  // ------------------------------------------------------------ pipeline

  private buildGraph(): Graph {
    // sinkId 'none': render on our own clock, no sound card (the output goes to ffmpeg).
    const ctx = new AudioContext({ sinkId: { type: 'none' }, sampleRate: SR } as unknown as AudioContextOptions)
    // @ts-expect-error node-web-audio-api's ScriptProcessorNode takes options (the DOM typings say it can't be constructed)
    const input = new ScriptProcessorNode(ctx, { bufferSize: BUF, numberOfInputChannels: 1, numberOfOutputChannels: 4 })
    const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 4 })
    input.connect(split)
    const sum = new GainNode(ctx, { gain: 0.5 }) // limiter curve spans -2..2
    const bass: BiquadFilterNode[] = []
    const trim: GainNode[] = []
    const gain: GainNode[] = []
    SINKS.forEach((_, d) => {
      const merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 })
      split.connect(merge, 2 * d, 0)
      split.connect(merge, 2 * d + 1, 1)
      const b = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 200, gain: this.bassDb[d]! })
      const t = new GainNode(ctx, { gain: dbToGain(this.trimDb[d]!) })
      const g = new GainNode(ctx, { gain: rampValue(this.gains[d]!) })
      merge.connect(b).connect(t).connect(g).connect(sum)
      bass.push(b)
      trim.push(t)
      gain.push(g)
    })
    const limiter = new WaveShaperNode(ctx, { curve: limiterCurve() })
    // @ts-expect-error see above
    const output = new ScriptProcessorNode(ctx, { bufferSize: BUF, numberOfInputChannels: 2, numberOfOutputChannels: 1 })
    sum.connect(limiter).connect(output).connect(ctx.destination) // silent; keeps it pulled

    const g: Graph = {
      ctx,
      bass,
      trim,
      gain,
      fifo: [0, 1, 2, 3].map(() => new Float32Array(RING)),
      w: 0,
      r: 0,
      primed: false,
      lastRender: performance.now(),
    }
    input.onaudioprocess = (e: any) => {
      if (this.graph === g) this.pull(g, e.outputBuffer)
    }
    output.onaudioprocess = (e: any) => {
      if (this.graph !== g) return // an abandoned graph that woke up again
      g.lastRender = performance.now()
      this.push(e.inputBuffer)
    }
    this.graph = g
    this.gains.forEach((r, d) => this.scheduleRamp(d, r)) // a crossfade may be under way
    return g
  }

  private start() {
    if (this.capture) return
    this.rest = Buffer.alloc(0)
    this.epoch++
    this.samples = this.bytesOut = this.backlogStart = 0
    this.backlog = []
    this.pcmBacklog = []
    this.anchors = []
    this.anchorMs = null
    const capture = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-fflags', 'nobuffer',
      ...SINKS.flatMap((s) => ['-f', 'pulse', '-sample_rate', String(SR), '-channels', '2', '-fragment_size', '3840', '-i', `${s}.monitor`]),
      '-filter_complex', '[0:a][1:a]amerge=inputs=2[m]', '-map', '[m]',
      '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    const encoder = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', 'pipe:0',
      '-c:a', 'libmp3lame', '-b:a', '192k', '-flush_packets', '1',
      '-id3v2_version', '0', '-write_xing', '0', '-f', 'mp3', 'pipe:1', // bare frames only
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.capture = capture
    this.encoder = encoder
    try {
      this.buildGraph()
    } catch (e) {
      console.error('[mixer] audio graph failed', e)
      this.onExit()
      return
    }

    capture.stdout!.on('data', (chunk: Buffer) => this.feed(chunk))
    encoder.stdout!.on('data', (chunk: Buffer) => this.broadcast(chunk))
    for (const [name, p] of [['capture', capture], ['encoder', encoder]] as const) {
      p.stderr!.on('data', (d) => console.error(`[mixer:${name}]`, String(d).trim()))
      p.on('exit', () => this.onExit())
    }
    encoder.stdin!.on('error', () => {})
    this.watchdog = setInterval(() => this.checkStall(), 1000)
  }

  private watchdog: ReturnType<typeof setInterval> | undefined

  /**
   * The native render thread can deadlock (seen after ~30 min: blocked on a futex, no more
   * callbacks) while capture and everything else keep running: the phones then hang on
   * "Connecting". If no audio comes out for 2 s while the decks are being captured,
   * rebuild the pipeline; the phones reconnect by themselves.
   */
  private checkStall() {
    const g = this.graph
    if (!g || performance.now() - g.lastRender < STALL_MS) return
    if (g.w - g.r < BUF) return // nothing captured either: not the graph's fault
    console.error(`[mixer] audio graph stalled for ${Math.round(performance.now() - g.lastRender)} ms: restarting the mix`)
    this.onExit(true)
  }

  /** `abandon`: the graph's render thread is stuck; don't wait on it (close() could block too). */
  private teardown(abandon = false) {
    clearInterval(this.watchdog)
    this.capture?.kill('SIGTERM')
    this.encoder?.kill('SIGTERM')
    this.capture = this.encoder = null
    const g = this.graph
    this.graph = null
    if (g && !abandon) g.ctx.close().catch(() => {})
  }

  private onExit(abandon = false) {
    if (!this.capture && !this.graph) return
    this.teardown(abandon)
    // Unexpected exit: the timeline restarts, so close the streams; the phones reconnect
    // (after 2 s), which starts everything again with a new epoch.
    for (const l of this.listeners.keys()) l.destroy()
  }

  private stop() {
    this.teardown()
  }

  /** ffmpeg capture (4ch f32: deck A L/R, deck B L/R) → planar FIFO. */
  private feed(chunk: Buffer) {
    const g = this.graph
    if (!g) return
    const data = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk
    const frames = Math.floor(data.length / 16)
    this.rest = Buffer.from(data.subarray(frames * 16))
    if (!frames) return
    const src = new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + frames * 16))
    const n = Math.min(frames, RING - (g.w - g.r)) // full: drop the overflow
    const [a, b, c, d] = g.fifo as [Float32Array, Float32Array, Float32Array, Float32Array]
    for (let f = 0; f < n; f++) {
      const p = (g.w + f) & (RING - 1)
      a[p] = src[4 * f]!
      b[p] = src[4 * f + 1]!
      c[p] = src[4 * f + 2]!
      d[p] = src[4 * f + 3]!
    }
    g.w += n
  }

  /** Render thread asks for the next BUF frames of capture. */
  private pull(g: Graph, out: AudioBuffer) {
    let avail = g.w - g.r
    if (avail > MAX_QUEUE) {
      g.r = g.w - PREFILL
      avail = PREFILL
    }
    if (!g.primed && avail < PREFILL) return // output stays silent
    const n = Math.min(avail, BUF)
    g.primed = avail >= BUF
    const start = g.r & (RING - 1)
    const first = Math.min(n, RING - start)
    const tmp = new Float32Array(BUF)
    g.fifo.forEach((ch, c) => {
      tmp.fill(0)
      tmp.set(ch.subarray(start, start + first), 0)
      if (first < n) tmp.set(ch.subarray(0, n - first), first)
      out.copyToChannel(tmp, c)
    })
    g.r += n
  }

  /** Mixed stereo → MP3 encoder. */
  private push(inp: AudioBuffer) {
    const stdin = this.encoder?.stdin
    if (!stdin?.writable) return
    const n = inp.length
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    inp.copyFromChannel(L, 0)
    inp.copyFromChannel(R, inp.numberOfChannels > 1 ? 1 : 0)
    const out = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      out[2 * i] = L[i]!
      out[2 * i + 1] = R[i]!
    }
    stdin.write(Buffer.from(out.buffer))

    // Same audio as raw 16-bit PCM, for browsers that can't stream MP3 (Firefox, iPhones).
    const i16 = new Int16Array(n * 2) // little-endian on every machine this runs on
    for (let i = 0; i < n * 2; i++) i16[i] = Math.max(-1, Math.min(1, out[i]!)) * 32767
    const pcm = Buffer.from(i16.buffer)
    this.pcmBacklog.push({ start: this.samples, data: pcm })
    if (this.pcmBacklog.length > PCM_BACKLOG_BLOCKS) this.pcmBacklog.shift()
    this.send('pcm', pcm)

    // Timing: these samples were rendered by now. Late callbacks only look later, so the
    // earliest estimate over a few seconds is the true anchor.
    this.samples += n
    this.anchors.push(nowMs() - (this.samples / SR) * 1000)
    if (this.anchors.length > ANCHOR_WINDOW) this.anchors.shift()
    this.anchorMs = Math.min(...this.anchors)
  }

  private broadcast(chunk: Buffer) {
    this.bytesOut += chunk.length
    this.backlog.push(chunk)
    while (this.backlog.length > 1 && this.bytesOut - this.backlogStart - this.backlog[0]!.length >= BACKLOG_BYTES) {
      this.backlogStart += this.backlog.shift()!.length
    }
    this.send('mp3', chunk)
  }

  private send(kind: StreamKind, chunk: Buffer) {
    for (const [l, k] of this.listeners) {
      if (k !== kind) continue
      // Never drop bytes (it would shift that phone's timeline): a stuck client is closed.
      if (l.writableLength > MAX_PENDING[kind]) l.destroy()
      else l.write(chunk)
    }
  }

  /** What phones need to place the stream on the server's clock. */
  get clock() {
    return { now: nowMs(), anchor: this.anchorMs, epoch: this.epoch, sr: SR, delay: SYNC_DELAY }
  }

  /**
   * A new listening stream, starting a few seconds back: MP3 (on a frame boundary), or raw
   * PCM (s16le stereo 48 kHz) for browsers that can't stream MP3.
   */
  addListener(kind: StreamKind = 'mp3'): { out: PassThrough; startSample: number; epoch: number } {
    clearTimeout(this.stopTimer)
    this.start()
    const out = new PassThrough({ highWaterMark: MAX_PENDING[kind] * 2 })
    let startSample: number
    if (kind === 'pcm') {
      startSample = this.pcmBacklog[0]?.start ?? this.samples
      for (const b of this.pcmBacklog) out.write(b.data)
    } else {
      const startByte = Math.ceil(Math.max(this.backlogStart, this.bytesOut - BACKLOG_BYTES) / FRAME_BYTES) * FRAME_BYTES
      let pos = this.backlogStart
      for (const c of this.backlog) {
        if (pos + c.length > startByte) out.write(c.subarray(Math.max(0, startByte - pos)))
        pos += c.length
      }
      startSample = (startByte / FRAME_BYTES) * FRAME_SAMPLES
    }
    this.listeners.set(out, kind)
    const done = () => {
      if (!this.listeners.delete(out)) return
      if (!this.listeners.size) {
        this.stopTimer = setTimeout(() => !this.listeners.size && this.stop(), 30_000)
      }
    }
    out.on('close', done)
    out.on('error', done)
    return { out, startSample, epoch: this.epoch }
  }

  get listenerCount() {
    return this.listeners.size
  }
}

export const mixer = new Mixer()
