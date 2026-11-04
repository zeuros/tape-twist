<script setup lang="ts">
/**
 * A small QR button; opens the /player link as a full-screen QR code to scan with a phone.
 * With Tailscale it's the short Funnel name (https://c-j.tailXXXX.ts.net/player): phones on the home
 * Wi-Fi get redirected to the LAN address by the server, the others stay on Funnel.
 */
import QRCode from 'qrcode'

const { guestUrl, load } = useGuestUrl()
const tsHost = ref<string | null>(null)
const playerUrl = computed(() => (tsHost.value ? `https://${tsHost.value}/player` : `${guestUrl.value}player`))
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
  load()
  tsHost.value = (await $fetch<{ host: string | null }>('/api/tailscale-host').catch(() => null))?.host ?? null
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
