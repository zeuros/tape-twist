<script setup lang="ts">
import type { XY } from '#shared/types/booth'

/**
 * XY pad: the finger position drives a DJ filter (x) and resonance + echo (y) on every
 * listening device. Applied here at once; sent at most every 60 ms, kept alive every 2 s.
 */
const { booth, xyLocal, xyShown, fx } = useBooth()
let sentAt = 0
let sendTimer: ReturnType<typeof setTimeout> | undefined
let keepAlive: ReturnType<typeof setInterval> | undefined
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function at(e: PointerEvent): XY {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01(1 - (e.clientY - r.top) / r.height) }
}
function send() {
  clearTimeout(sendTimer)
  if (!xyLocal.value) return
  const wait = 60 - (Date.now() - sentAt)
  if (wait > 0) {
    sendTimer = setTimeout(send, wait)
    return
  }
  sentAt = Date.now()
  fx('xy', { ...xyLocal.value, on: true })
}
function down(e: PointerEvent) {
  e.preventDefault()
  capturePointer(e)
  xyLocal.value = at(e)
  send()
  clearInterval(keepAlive)
  keepAlive = setInterval(() => xyLocal.value && fx('xy', { ...xyLocal.value, on: true }), 2000)
  navigator.vibrate?.(10)
}
function move(e: PointerEvent) {
  if (!xyLocal.value) return
  xyLocal.value = at(e)
  send()
}
function up() {
  if (!xyLocal.value) return
  xyLocal.value = null
  clearTimeout(sendTimer)
  clearInterval(keepAlive)
  booth.value.xy = null
  fx('xy', { on: false })
}
onBeforeUnmount(() => {
  clearTimeout(sendTimer)
  clearInterval(keepAlive)
})
</script>

<template>
  <div
    class="xy"
    :class="{ on: !!xyShown }"
    title="Drag: left = low-pass, right = high-pass, up = resonance + echo. Let go to come back."
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
    @contextmenu.prevent
  >
    <span class="xy-l">◀ low</span>
    <span class="xy-r">high ▶</span>
    <span class="xy-t">▲ resonance + echo</span>
    <span v-if="xyShown" class="xy-dot" :style="{ left: `${xyShown.x * 100}%`, top: `${(1 - xyShown.y) * 100}%` }" />
  </div>
</template>
