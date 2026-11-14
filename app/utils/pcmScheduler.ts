/**
 * Plays numbered blocks of audio with Web Audio, each at the context time matching its shared
 * server time. Consecutive blocks are butted together, and drift is steered out with a tiny
 * playback-rate change on the next blocks; a big error reschedules everything still waiting.
 */

export const PCM_JUMP = 0.03 // s of error fixed by rescheduling instead of the rate
/** Errors under this are left alone: every rate change starts a new resampler (a seam). */
export const PCM_DEADBAND = 0.005
export const PCM_MAX_RATE = 0.005 // ±0.5 %: inaudible
/** Unsynced (no shared clock yet): start this far ahead of now. */
export const UNSYNCED_LEAD = 0.3

/** The bits of AudioContext the scheduler uses (a fake in tests). */
export interface SchedulerContext {
  readonly currentTime: number
  readonly sampleRate: number
  createBufferSource(): AudioBufferSourceNode
}

interface Block {
  buf: AudioBuffer
  s: number
  src: AudioBufferSourceNode | null
  t: number // context time it starts at
  end: number
}

export interface SchedulerHooks {
  /** Context time at which stream sample `s` should be heard, or null while unknown. */
  idealTime: (s: number) => number | null
  /** A block was played without a shared clock. */
  onUnsynced?: () => void
  /** The first block was scheduled. */
  onPlaying?: () => void
  /**
   * Each block placed: false when it was already over (dropped, nothing heard). `lead`: seconds
   * between scheduling it and its start (< 0: its start was cut).
   */
  onBlock?: (played: boolean, lead: number) => void
}

export function createScheduler(ctx: SchedulerContext, dest: AudioNode, hooks: SchedulerHooks) {
  let nextT: number | null = null // where the next block starts if it follows on
  let lastError: number | null = null
  let started = false
  let blocks: Block[] = [] // scheduled and not finished yet

  const startBlock = (b: Block, t: number, rate: number) => {
    const now = ctx.currentTime
    // On a whole sample frame: a start between two frames is rounded by the browser, separately
    // from where the previous block ends (a one-sample hole or overlap: a click).
    t = Math.round(t * ctx.sampleRate) / ctx.sampleRate
    const dur = b.buf.duration / rate
    b.t = t
    b.end = t + dur
    if (b.end <= now + 0.005) {
      hooks.onBlock?.(false, t - now)
      return (b.src = null) // too late: skip it
    }
    const src = ctx.createBufferSource()
    src.buffer = b.buf
    src.playbackRate.value = rate
    src.connect(dest)
    if (t >= now) src.start(t)
    else src.start(now, (now - t) * rate) // partly late: play the rest
    b.src = src
    hooks.onBlock?.(true, t - now)
    if (!started) {
      started = true
      hooks.onPlaying?.()
    }
  }

  /** Throw away the schedule and place every waiting block at its ideal time again. */
  const reschedule = () => {
    const now = ctx.currentTime
    nextT = null
    for (const b of blocks) {
      if (b.src && b.t <= now + 0.01) continue // already sounding: let it finish
      b.src?.stop()
      b.src?.disconnect()
      const t = hooks.idealTime(b.s)
      if (t == null) continue
      startBlock(b, nextT ?? t, 1)
      nextT = b.end
    }
  }

  return {
    /** Schedule the block of `buf` starting at stream sample `s`. */
    push(buf: AudioBuffer, s: number) {
      const b: Block = { buf, s, src: null, t: 0, end: 0 }
      const now = ctx.currentTime
      blocks = blocks.filter((x) => x.end > now)
      blocks.push(b)
      const ideal = hooks.idealTime(s)
      if (ideal == null) {
        // No shared clock yet: just play it continuously, a little ahead of now.
        lastError = null
        hooks.onUnsynced?.()
        if (nextT == null || nextT < now) nextT = now + UNSYNCED_LEAD
        startBlock(b, nextT, 1)
        nextT = b.end
        return
      }
      const err = nextT == null ? Infinity : nextT - ideal // > 0: running late
      if (Math.abs(err) > PCM_JUMP) {
        lastError = 0
        reschedule()
        return
      }
      lastError = err
      const rate = Math.abs(err) < PCM_DEADBAND ? 1 : 1 + Math.max(-PCM_MAX_RATE, Math.min(PCM_MAX_RATE, err * 0.25))
      startBlock(b, nextT!, rate)
      nextT = b.end
    },
    /** Last measured error in seconds (> 0: late), null while unsynced. */
    lastError: () => lastError,
    stop() {
      for (const b of blocks) {
        try {
          b.src?.stop()
        } catch {
          /* never started */
        }
        b.src?.disconnect()
      }
      blocks = []
    },
  }
}
