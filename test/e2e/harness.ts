/**
 * End-to-end harness: the real server (built into .output-e2e), fed by a test beat played into
 * its own PipeWire sink, and real browsers listening to it. Every page's Web Audio output is
 * tapped (see INSTRUMENT), so a test can tell what each "phone" actually plays.
 *
 * Isolation from a server running on the same machine: its own port, data folder
 * (a temporary one), build folders and sinks (TAPE_TWIST_SINKS=tape_twist_e2e).
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = resolve(import.meta.dirname, '../..')
export const SINK_PREFIX = 'tape_twist_e2e'
/** The browsers play into this null sink: nothing reaches the speakers, timing stays real. */
export const OUT_SINK = `${SINK_PREFIX}_out`
export const BPM = 124

// ------------------------------------------------------------------ PipeWire

/** Creates the test sinks; returns a function that removes them. */
export async function createSinks() {
  const modules: string[] = []
  const { stdout } = await run('pactl', ['list', 'short', 'sinks'])
  for (const s of [`${SINK_PREFIX}_a`, `${SINK_PREFIX}_b`, OUT_SINK]) {
    if (stdout.split('\n').some((l) => l.split('\t')[1] === s)) continue
    const r = await run('pactl', ['load-module', 'module-null-sink', `sink_name=${s}`, `sink_properties=device.description=E2E-${s}`])
    modules.push(r.stdout.trim())
  }
  return async () => {
    for (const m of modules) await run('pactl', ['unload-module', m]).catch(() => {})
  }
}

/**
 * A 124 BPM beat into deck A's sink, in real time: a kick (pitch-swept sine) on every beat
 * over a steady 220 Hz tone, so the music is never silent between kicks (a gap = a dropout).
 */
export function playBeat(): ChildProcess {
  const beat = (60 / BPM).toFixed(6)
  const m = `mod(t,${beat})`
  const expr = `0.55*sin(2*PI*(45+90*exp(-${m}*25))*${m})*exp(-${m}*7)+0.12*sin(2*PI*220*t)`
  return spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-re',
    '-f', 'lavfi', '-i', `aevalsrc='${expr}|${expr}':s=48000`,
    '-f', 'pulse', '-device', `${SINK_PREFIX}_a`, 'e2e-beat',
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
}

// ------------------------------------------------------------------ server

export interface TestServer {
  url: string
  port: number
  dataDir: string
  stop(): Promise<void>
}

export async function startServer(port: number): Promise<TestServer> {
  const dataDir = await mkdtemp(join(tmpdir(), 'evening-e2e-'))
  const proc = spawn('node', [join(ROOT, '.output-e2e/server/index.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: dataDir,
      PADS_DIR: join(ROOT, 'pads'),
      TAPE_TWIST_E2E: '1',
      TAPE_TWIST_SINKS: SINK_PREFIX,
      LAN_REDIRECT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const log: string[] = []
  proc.stdout!.on('data', (d) => log.push(String(d)))
  proc.stderr!.on('data', (d) => log.push(String(d)))
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; ; i++) {
    if (proc.exitCode != null) throw new Error(`server exited:\n${log.join('')}`)
    if (await fetch(`${url}/api/clock`).then((r) => r.ok, () => false)) break
    if (i > 100) throw new Error(`server did not start:\n${log.join('')}`)
    await sleep(100)
  }
  return {
    url,
    port,
    dataDir,
    async stop() {
      proc.kill('SIGTERM')
      await new Promise((r) => (proc.exitCode != null ? r(null) : proc.once('exit', r)))
      await rm(dataDir, { recursive: true, force: true })
    },
  }
}

// --------------------------------------------------------------- 4G link

export interface Link {
  server: Server
  close(): void
}

/**
 * A TCP proxy that behaves like a phone on 4G: every chunk from the server is held for
 * 30–80 ms, and every 2–6 s the cell hiccups: nothing gets through for up to `spikeMs`, then
 * it all arrives at once. Order is kept, like TCP.
 */
export function jitterProxy(target: number, port: number, spikeMs = 220, seed = 7): Promise<Link> {
  let s = seed
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  // One queue per direction, sent in order: each chunk leaves at its own time, never before the last.
  let hiccup = { from: Date.now() + 2000, to: Date.now() + 2000 }
  /** When a chunk sent now gets through: after the current hiccup, if any. */
  const through = (at: number) => {
    const now = Date.now()
    if (now > hiccup.to) {
      const from = now + 2000 + rand() * 4000
      hiccup = { from, to: from + (0.3 + 0.7 * rand()) * spikeMs }
    }
    return now >= hiccup.from && now < hiccup.to ? Math.max(at, hiccup.to) : at
  }
  const delayed = (from: Socket, to: Socket, extra: () => number, hiccups = false) => {
    const queue: { at: number; chunk: Buffer }[] = []
    let timer: ReturnType<typeof setTimeout> | null = null
    const drain = () => {
      timer = null
      while (queue.length && queue[0]!.at <= Date.now()) {
        const { chunk } = queue.shift()!
        if (to.writable) to.write(chunk)
      }
      if (queue.length) timer = setTimeout(drain, Math.max(0, queue[0]!.at - Date.now()))
    }
    from.on('data', (chunk) => {
      const last = queue.at(-1)?.at ?? 0
      const at = Date.now() + extra()
      queue.push({ at: Math.max(last, hiccups ? through(at) : at), chunk })
      timer ??= setTimeout(drain, Math.max(0, queue[0]!.at - Date.now()))
    })
  }
  const server = createServer((client) => {
    const up = createConnection(target, '127.0.0.1')
    delayed(client, up, () => 15 + rand() * 25)
    delayed(up, client, () => 30 + rand() * 50, true)
    const close = () => {
      client.destroy()
      up.destroy()
    }
    client.on('close', close).on('error', close)
    up.on('close', close).on('error', close)
  })
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({
    server,
    close: () => server.close(),
  })))
}

// --------------------------------------------------------- page instrumentation

/**
 * Runs in every page before the app. It taps each audio context's output (an analyser on
 * whatever connects to `destination`) and every 25 ms notes its level, so a test can read:
 *  - `__e2e.level(i, ms)`: the lowest and highest level of open context i (0 = music, 1 = pads/voice)
 *    over the last `ms` (the 25 ms readings);
 *  - `__e2e.gaps(i, sinceMs, floor)`: how often context i dropped below `floor` since then;
 *  - `__e2e.errors`: uncaught errors and rejections.
 */
export const INSTRUMENT = () => {
  type Tap = { ctx: BaseAudioContext; an: AnalyserNode; buf: Float32Array; log: [number, number][] }
  const taps: Tap[] = []
  const errors: string[] = []
  const w = window as any
  addEventListener('error', (e) => errors.push(String(e.message)))
  addEventListener('unhandledrejection', (e) => errors.push(`rejection: ${String((e as PromiseRejectionEvent).reason)}`))
  const connect = AudioNode.prototype.connect as any
  AudioNode.prototype.connect = function (this: AudioNode, dest: any, ...rest: any[]) {
    if (dest instanceof AudioDestinationNode) {
      let tap = taps.find((t) => t.ctx === this.context)
      if (!tap) {
        const an = this.context.createAnalyser()
        an.fftSize = 1024
        tap = { ctx: this.context, an, buf: new Float32Array(1024), log: [] }
        taps.push(tap)
        // Pulled into the output through a silent gain, or the browser may skip it.
        const mute = this.context.createGain()
        mute.gain.value = 0
        connect.call(an, mute)
        connect.call(mute, dest)
      }
      connect.call(this, tap.an)
    }
    return connect.call(this, dest, ...rest)
  } as any
  setInterval(() => {
    const now = performance.now()
    for (const t of taps) {
      t.an.getFloatTimeDomainData(t.buf as Float32Array<ArrayBuffer>)
      let sum = 0
      for (const x of t.buf) sum += x * x
      const rms = Math.sqrt(sum / t.buf.length)
      t.log.push([now, Number.isFinite(rms) ? rms : -1]) // -1: NaN in the graph
      while (t.log.length && t.log[0]![0] < now - 120_000) t.log.shift()
    }
  }, 25)
  // Contexts still open, in creation order: Listen pressed by hand replaces them.
  const live = () => taps.filter((t) => t.ctx.state !== 'closed')
  const since = (i: number, ms: number) => (live()[i]?.log ?? []).filter(([t]) => t >= performance.now() - ms).map(([, v]) => v)
  w.__e2e = {
    errors,
    taps,
    contexts: () => live().map((t) => t.ctx.state),
    level(i: number, ms = 300) {
      const v = since(i, ms)
      return v.length ? { min: Math.min(...v), max: Math.max(...v), n: v.length } : null
    },
    /** Readings below `floor` in the last `ms`, as runs (start offset ms, length ms). */
    gaps(i: number, ms: number, floor: number) {
      const log = (live()[i]?.log ?? []).filter(([t]) => t >= performance.now() - ms)
      const runs: [number, number][] = []
      let start: number | null = null
      for (const [t, v] of log) {
        if (v < floor && v >= 0) start ??= t
        else if (start != null) {
          runs.push([Math.round(start - log[0]![0]), Math.round(t - start)])
          start = null
        }
      }
      if (start != null) runs.push([Math.round(start - log[0]![0]), Math.round(performance.now() - start)])
      return runs
    },
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Waits until `check` returns true (polled every 100 ms); throws `what` after `ms`. */
export async function until(what: string, check: () => Promise<boolean> | boolean, ms = 5000) {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`)
    await sleep(100)
  }
}
