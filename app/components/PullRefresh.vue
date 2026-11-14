<script setup lang="ts">
/**
 * Pull down from the top of the page to reload it, like a mobile browser. Only in the Android
 * app: its WebView has no such gesture (and browsers already have their own). A way out when
 * the page gets stuck in a bad state.
 */
const ARM = 72 // px of (damped) pull that arms the reload
const MAX = 110

const pull = ref(0)
const reloading = ref(false)
let start: { x: number; y: number } | null = null

/** Touches that belong to the page: a drag control, or a box that's scrolled away from its top. */
function claimed(el: Element | null): boolean {
  for (; el && el !== document.body; el = el.parentElement) {
    if (el instanceof HTMLInputElement && el.type === 'range') return true
    const css = getComputedStyle(el)
    if (!/auto|manipulation|pan-y|pan-down/.test(css.touchAction)) return true // none, pan-x, pinch-zoom…
    if (el.scrollTop > 0 && /auto|scroll/.test(css.overflowY)) return true
  }
  return false
}

function onStart(e: TouchEvent) {
  start = null
  if (reloading.value || e.touches.length !== 1 || window.scrollY > 0 || claimed(e.target as Element)) return
  start = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }
}
function onMove(e: TouchEvent) {
  if (!start) return
  const t = e.touches[0]!
  const dx = t.clientX - start.x
  const dy = t.clientY - start.y
  // a sideways swipe, a second finger or the page scrolled: not a pull
  if (e.touches.length !== 1 || window.scrollY > 0 || (pull.value === 0 && Math.abs(dx) > Math.abs(dy))) {
    start = null
    pull.value = 0
    return
  }
  pull.value = dy > 0 ? Math.min(MAX, dy * 0.5) : 0
}
function onEnd() {
  if (start && pull.value >= ARM) {
    reloading.value = true
    pull.value = ARM
    location.reload()
  } else pull.value = 0
  start = null
}

onMounted(() => {
  if (!isNative()) return
  window.addEventListener('touchstart', onStart, { passive: true })
  window.addEventListener('touchmove', onMove, { passive: true })
  window.addEventListener('touchend', onEnd, { passive: true })
  window.addEventListener('touchcancel', onEnd, { passive: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('touchstart', onStart)
  window.removeEventListener('touchmove', onMove)
  window.removeEventListener('touchend', onEnd)
  window.removeEventListener('touchcancel', onEnd)
})
</script>

<template>
  <div
    v-show="pull > 0 || reloading"
    class="pull-refresh"
    :class="{ armed: pull >= ARM }"
    :style="{ transform: `translate(-50%, ${pull - 48}px)`, opacity: Math.min(1, pull / ARM) }"
    aria-hidden="true"
  >
    <BrandLogo :spinning="reloading" :style="{ rotate: reloading ? '0deg' : `${(Math.min(pull, ARM) / ARM) * 180 - 180}deg` }" />
  </div>
</template>

<style scoped>
.pull-refresh { position: fixed; top: 0; left: 50%; z-index: 2000; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--panel); box-shadow: var(--shadow); pointer-events: none; }
.pull-refresh .logo { height: 16px; transition: rotate .1s; }
.pull-refresh.armed { background: var(--panel-2); outline: 2px solid var(--accent); }
</style>
