import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Virtual PipeWire/PulseAudio sinks, one per deck. Nothing reaches the real speakers.
 * EVENING_SINKS renames them (the end-to-end tests use their own, next to a running server).
 */
const SINK_PREFIX = process.env.EVENING_SINKS || 'evening_mix'
export const SINKS = [`${SINK_PREFIX}_a`, `${SINK_PREFIX}_b`] as const
export type SinkName = (typeof SINKS)[number]

export async function ensureSinks() {
  const { stdout } = await run('pactl', ['list', 'short', 'sinks'])
  for (const s of SINKS) {
    if (!stdout.split('\n').some((l) => l.split('\t')[1] === s)) {
      await run('pactl', [
        'load-module', 'module-null-sink', `sink_name=${s}`,
        `sink_properties=device.description=Evening-Mix-${s.slice(-1).toUpperCase()}`,
      ])
    }
    // Deck volumes are applied in the mixer graph; the sinks themselves stay at 100 %.
    await run('pactl', ['set-sink-volume', s, '100%'])
  }
}

export const deckTag = (sink: SinkName) => sink.slice(-1) // "a" | "b"

/**
 * PipeWire's stream-restore remembers one target per application name, and both decks
 * are "Chromium": a deck that reopens its audio stream can land on the other deck's sink
 * (or on real speakers). Each deck tags its streams with PULSE_PROP evening.deck=<x>;
 * this moves any stray tagged stream back to its own sink.
 */
export async function enforceRouting() {
  const [{ stdout: inputs }, { stdout: sinks }] = await Promise.all([
    run('pactl', ['-f', 'json', 'list', 'sink-inputs']),
    run('pactl', ['list', 'short', 'sinks']),
  ])
  const sinkIndex = new Map(
    sinks.split('\n').filter(Boolean).map((l) => {
      const [idx, name] = l.split('\t')
      return [name, Number(idx)] as const
    }),
  )
  const moves: Promise<unknown>[] = []
  for (const i of JSON.parse(inputs) as { index: number; sink: number; properties: Record<string, string> }[]) {
    const tag = i.properties?.['evening.deck']
    const want = SINKS.find((s) => deckTag(s) === tag)
    const wantIdx = want && sinkIndex.get(want)
    if (want && wantIdx !== undefined && i.sink !== wantIdx) {
      moves.push(run('pactl', ['move-sink-input', String(i.index), want]).catch(() => {}))
    }
  }
  await Promise.all(moves)
  return moves.length
}
