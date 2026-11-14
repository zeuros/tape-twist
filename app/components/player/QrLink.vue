<script setup lang="ts">
/**
 * A small QR button; opens the /player link as a full-screen QR code to scan with a phone.
 * With Tailscale it's the short Funnel name (https://c-j.tailXXXX.ts.net/player): phones on the home
 * Wi-Fi get redirected to the LAN address by the server, the others stay on Funnel. Without it,
 * the address this page was opened on, or the LAN address when that's localhost (a phone can't
 * reach the host's "localhost").
 */
import QRCode from 'qrcode'

const tsHost = ref<string | null>(null)
const lanIp = ref<string | null>(null)
const playerUrl = computed(() => {
  if (tsHost.value) return `https://${tsHost.value}/player`
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  const host = local && lanIp.value ? `${lanIp.value}${location.port ? `:${location.port}` : ''}` : location.host
  return `${location.protocol}//${host}/player`
})
const open = ref(false)
const svg = ref('')

watch([open, playerUrl], async () => {
  if (!open.value) return
  svg.value = await QRCode.toString(playerUrl.value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
})

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
onMounted(async () => {
  document.addEventListener('keydown', onKey)
  const [ts, ips] = await Promise.all([
    $fetch<{ host: string | null }>('/api/tailscale-host').catch(() => null),
    $fetch<string[]>('/api/lan').catch(() => []),
  ])
  tsHost.value = ts?.host ?? null
  // Prefer a home-network address over Docker bridges and VPNs.
  lanIp.value = ips.find((ip) => /^(192\.168|10)\./.test(ip)) ?? ips[0] ?? null
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <button class="qr-btn" title="Show the player link as a QR code" aria-label="Show player QR code" @click="open = true">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3h7v7H3zm2 2v3h3V5zm9-2h7v7h-7zm2 2v3h3V5zM3 14h7v7H3zm2 2v3h3v-3zm9-2h2v2h-2zm2 2h2v2h-2zm2-2h3v2h-3zm-4 4h2v3h-2zm4 0h3v3h-2v-1h-1z" />
    </svg>
  </button>

  <Teleport to="body">
    <div v-if="open" class="qr-full" role="dialog" aria-label="Player QR code" @click="open = false">
      <div class="qr-card">
        <!-- eslint-disable-next-line vue/no-v-html -- SVG generated locally from our own URL -->
        <div class="qr-code" v-html="svg" />
        <p class="qr-hint">Scan to open the player</p>
        <p class="qr-url">{{ playerUrl }}</p>
      </div>
      <span class="qr-close">Tap anywhere to close</span>
    </div>
  </Teleport>
</template>
