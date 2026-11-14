<script setup lang="ts">
/**
 * The host page's lock: the PIN, once per device (a cookie keeps it). Sent as soon as it has
 * `length` characters. Wrong tries wait 10 s.
 */
const props = defineProps<{ length: number }>()
const pin = ref('')
const busy = ref(false)
const msg = ref('')
const wait = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

function countdown(sec: number, what: string) {
  wait.value = sec
  clearInterval(timer)
  const tick = () => {
    msg.value = wait.value > 0 ? `${what}, try again in ${wait.value} s` : what
    if (wait.value-- <= 0) clearInterval(timer)
  }
  tick()
  timer = setInterval(tick, 1000)
}

async function unlock() {
  if (!pin.value || busy.value || wait.value > 0) return
  busy.value = true
  try {
    await $fetch('/api/auth', { method: 'POST', body: { pin: pin.value } })
    location.reload()
  } catch (e: any) {
    const status = e?.response?.status
    const sec = Number(e?.data?.data?.retryAfter) || 10
    pin.value = ''
    if (status === 401) countdown(sec, 'Wrong PIN')
    else if (status === 429) countdown(sec, 'Too many tries')
    else msg.value = 'Server unreachable'
  } finally {
    busy.value = false
  }
}
watch(pin, (v) => {
  if (props.length > 0 && v.length >= props.length) void unlock()
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <form class="pin-gate" @submit.prevent="unlock">
    <BrandLogo />
    <label for="pin">Host PIN</label>
    <input
      id="pin"
      v-model="pin"
      type="password"
      inputmode="numeric"
      autocomplete="current-password"
      maxlength="32"
      autofocus
    />
    <button class="primary" :disabled="busy || wait > 0 || !pin">Unlock</button>
    <p class="pin-msg" aria-live="polite">{{ msg }}</p>
    <a href="/">Guest page →</a>
  </form>
</template>
