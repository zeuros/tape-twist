import type { HostStatus } from '#shared/types/engine'
import { engine } from './engine'
import { loadEvening } from './store'

/** Engine snapshot plus what the host UI needs to know about shared state. */
export async function hostStatus(): Promise<HostStatus> {
  const [snap, ev] = await Promise.all([engine.snapshot(), loadEvening()])
  return { ...snap, eveningRev: ev.rev ?? 0 }
}
