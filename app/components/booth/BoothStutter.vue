<script setup lang="ts">
import { STUTTER_BEATS } from '#shared/types/booth'

/**
 * Stutter: hold a length and the last slice of music loops; slide across to change the
 * length while holding. Sent like the XY pad: at once, then kept alive every 2 s.
 */
const { booth, stutterLocal, stutterShown, fx } = useBooth()
const LABELS = ['1 beat', '½', '¼', '⅛']
let keepAlive: ReturnType<typeof setInterval> | undefined

function at(e: PointerEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const i = Math.floor(((e.clientX - r.left) / r.width) * STUTTER_BEATS.length)
  return STUTTER_BEATS[Math.max(0, Math.min(STUTTER_BEATS.length - 1, i))]!
}
function set(beats: number) {
  if (stutterLocal.value === beats) return
  stutterLocal.value = beats
  fx('stutter', { value: beats, on: true })
}
function down(e: PointerEvent) {
  e.preventDefault()
  capturePointer(e)
  set(at(e))
  clearInterval(keepAlive)
  keepAlive = setInterval(() => stutterLocal.value && fx('stutter', { value: stutterLocal.value, on: true }), 2000)
  navigator.vibrate?.(10)
}
function move(e: PointerEvent) {
  if (stutterLocal.value != null) set(at(e))
}
function up() {
  if (stutterLocal.value == null) return
  stutterLocal.value = null
  clearInterval(keepAlive)
  booth.value.stutter = null
  fx('stutter', { on: false })
}
onBeforeUnmount(() => clearInterval(keepAlive))
</script>

<template>
  <div class="stutter">
    <div class="stutter-head">
      <span>🔁 Stutter <small>hold, slide to change</small></span>
      <small :title="booth.bpm ? 'Tempo measured on the music' : 'No clear beat right now: 124 BPM is used'">{{ booth.bpm ? `${Math.round(booth.bpm)} BPM` : '— BPM' }}</small>
    </div>
    <div
      class="stutter-strip"
      title="Hold: loops the last slice of music (1, ½, ¼ or ⅛ beat); let go to come back live"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
      @contextmenu.prevent
    >
      <span v-for="(b, i) in STUTTER_BEATS" :key="b" :class="{ on: stutterShown === b }">{{ LABELS[i] }}</span>
    </div>
  </div>
</template>
