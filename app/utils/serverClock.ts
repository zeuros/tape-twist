/** The server's clock, as seen from this page (NTP-style probes of /api/clock). */

export interface ClockReply {
  now: number
  anchor: number | null
  epoch: number
  sr: number
  delay: number
}

/** Offset between this page's clock and the server's, from the probes with the shortest round trip. */
export class ServerClock {
  offset: number | null = null // server ms − performance.now()
  rtt = Infinity
  info: ClockReply | null = null
  private probes: { offset: number; rtt: number; at: number }[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false

  async start() {
    for (let i = 0; i < 8 && !this.stopped; i++) await this.probe()
    this.schedule()
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
  }

  now() {
    return this.offset == null ? null : performance.now() + this.offset
  }

  private refreshing = false
  /** Ask again soon (the stream (re)started and its timeline wasn't known yet). */
  refresh() {
    if (this.refreshing || this.offset == null) return // the first probes are still running
    this.refreshing = true
    clearTimeout(this.timer)
    this.timer = setTimeout(async () => {
      await this.probe()
      this.refreshing = false
      this.schedule()
    }, 500)
  }

  private schedule() {
    if (this.stopped) return
    this.timer = setTimeout(async () => {
      for (let i = 0; i < 3; i++) await this.probe()
      this.schedule()
    }, 10_000)
  }

  private async probe() {
    try {
      const t0 = performance.now()
      const r = (await (await fetch(`/api/clock?t=${Math.random()}`, { cache: 'no-store' })).json()) as ClockReply
      const t1 = performance.now()
      this.info = r
      // Keep a minute of probes; phone and server clocks drift a little, so old ones expire.
      this.probes.push({ offset: r.now - (t0 + t1) / 2, rtt: t1 - t0, at: t1 })
      this.probes = this.probes.filter((p) => t1 - p.at < 60_000)
      const best = this.probes.reduce((a, b) => (b.rtt < a.rtt ? b : a))
      this.offset = best.offset
      this.rtt = best.rtt
    } catch {
      /* next round */
    }
  }
}
