import type { HostRequest } from '#shared/types/engine'

/** Guest requests, as the host sees them: reloaded whenever the pending count changes. */
export const useRequests = defineSingleton(() => {
  const requests = ref<HostRequest[]>([])
  const pending = computed(() => requests.value.filter((r) => r.status === 'pending'))
  const decided = computed(() => requests.value.filter((r) => r.status !== 'pending').slice(0, 8))
  let lastPending = -1

  async function load() {
    requests.value = await $fetch<HostRequest[]>('/api/requests').catch(() => requests.value)
  }

  /** The engine reports the pending count with every poll. */
  function notePending(n: number) {
    if (n === lastPending) return
    lastPending = n
    load()
  }

  async function decide(r: HostRequest, action: 'approve' | 'reject') {
    r.status = action === 'approve' ? 'approved' : 'rejected'
    await $fetch(`/api/requests/${r.id}`, { method: 'POST', body: { action } }).catch(() => {})
    await load()
    if (action === 'approve') await useEvening().reload() // it was inserted after the current track
  }

  return { pending, decided, notePending, decide }
})
