import { engine } from './engine'
import { listRequests } from './requests'
import { loadEvening } from './store'

/** Engine snapshot plus what the host UI needs to know about shared state. */
export async function hostStatus() {
  const [snap, ev, reqs] = await Promise.all([engine.snapshot(), loadEvening(), listRequests()])
  return { ...snap, eveningRev: ev.rev ?? 0, pendingRequests: reqs.filter((r) => r.status === 'pending').length }
}
