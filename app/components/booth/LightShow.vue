<script setup lang="ts">
/**
 * Light show: when someone switches it on (Booth → 💡 Lights), every phone listening at that
 * moment (theirs too) turns its screen into a light that flashes a new colour on each kick of
 * the music it plays. The kicks are found in this device's own audio and shown when they
 * reach the speaker, so all phones flash together, like the music. A tap hides it on this
 * phone. A phone that starts listening while it's on doesn't join in: tapping "Listen here"
 * never makes the screen flash by surprise (switching it off and on again brings everyone in).
 */
const { booth } = useBooth()
const listen = useListening()
const el = ref<HTMLElement | null>(null)
/** This phone takes part: it was listening when the lights were switched on, and wasn't tapped. */
const active = ref(false)
const shown = computed(() => active.value && listen.listening.value)
watch(() => booth.value.lights, (on, was) => {
  if (!on) active.value = false
  else if (!was && listen.listening.value) active.value = true
})
watch(listen.listening, (on) => on || (active.value = false))

let raf = 0
let avg = 0
let prev = 0
let lastKick = 0
let hue = Math.random() * 360
let glow = 0
let lock: { release(): Promise<void> } | null = null

function frame() {
  raf = requestAnimationFrame(frame)
  const a = listen.getAudio()
  if (!a) return
  const lvl = a.kickLevel()
  const now = performance.now()
  // A kick: the bass jumps well above its recent average.
  if (lvl > 0.012 && lvl > avg * 1.35 && lvl > prev && now - lastKick > 220) {
    lastKick = now
    const strength = Math.min(1, 0.55 + (lvl / Math.max(avg, 1e-4) - 1) * 0.6)
    setTimeout(() => {
      hue = (hue + 60 + Math.random() * 90) % 360
      glow = Math.max(glow, strength)
    }, a.outputLatency() * 1000) // the analyser hears it before the speaker plays it
  }
  avg += (lvl - avg) * 0.05
  prev = lvl
  glow *= 0.88
  if (el.value) el.value.style.background = `hsl(${hue} 100% ${Math.round(glow * 55)}%)`
}

async function keepScreenOn() {
  nativeKeepAwake(true)
  try {
    lock = (await (navigator as any).wakeLock?.request('screen')) ?? null
  } catch {
    /* refused (battery saver…): the screen may dim */
  }
}
const onVisible = () => document.visibilityState === 'visible' && shown.value && void keepScreenOn()

watch(shown, (on) => {
  cancelAnimationFrame(raf)
  if (on) {
    avg = prev = glow = 0
    raf = requestAnimationFrame(frame)
    void keepScreenOn()
  } else {
    nativeKeepAwake(false)
    void lock?.release().catch(() => {})
    lock = null
  }
})
onMounted(() => document.addEventListener('visibilitychange', onVisible))
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  nativeKeepAwake(false)
  void lock?.release().catch(() => {})
  document.removeEventListener('visibilitychange', onVisible)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="shown" ref="el" class="lightshow" role="button" aria-label="Hide the light show on this phone" @click="active = false" @keydown.esc="active = false">
      <span class="lightshow-hint">💡 Light show · tap to hide</span>
    </div>
  </Teleport>
</template>
