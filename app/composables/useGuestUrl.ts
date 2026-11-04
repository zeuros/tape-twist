/**
 * The address to give guests: the one this page was opened on, or the LAN address when it was
 * opened as localhost (a phone can't reach the host's "localhost").
 */
export const useGuestUrl = defineSingleton(() => {
  const lanIp = ref<string | null>(null)
  let asked = false

  const guestUrl = computed(() => {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    const host = local && lanIp.value ? `${lanIp.value}${location.port ? `:${location.port}` : ''}` : location.host
    return `${location.protocol}//${host}/`
  })

  async function load() {
    if (asked) return
    asked = true
    const ips = await $fetch<string[]>('/api/lan').catch(() => [])
    // Prefer a home-network address over Docker bridges and VPNs.
    lanIp.value = ips.find((ip) => /^(192\.168|10)\./.test(ip)) ?? ips[0] ?? null
  }

  return { guestUrl, load }
})
