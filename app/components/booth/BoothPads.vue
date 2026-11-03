<script setup lang="ts">
import type { Pad } from '#shared/types/booth'

/** The soundboard, and the tile that records a new pad (then asks its name inline). */
const { booth, pads, hitPad, deletePad } = useBooth()
const rec = usePadRecorder()
const { armed, confirm } = useConfirmTap()
const nameEl = ref<HTMLInputElement | null>(null)
watch(rec.take, (t) => t && nextTick(() => nameEl.value?.select()))

// Pads fire on press with a mouse (instant), but on a touch screen only on a real tap:
// lifting the finger where it went down. A finger that scrolls the page doesn't fire.
const touches = new Map<number, { x: number; y: number }>()
const TAP_SLOP = 10
function padDown(e: PointerEvent, p: Pad) {
  if (e.pointerType === 'mouse') {
    e.preventDefault()
    hitPad(p)
  } else touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
}
function padMove(e: PointerEvent) {
  const t = touches.get(e.pointerId)
  if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) > TAP_SLOP) touches.delete(e.pointerId)
}
function padUp(e: PointerEvent, p: Pad) {
  const t = touches.get(e.pointerId)
  touches.delete(e.pointerId)
  if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) <= TAP_SLOP) hitPad(p)
}

function recDown(e: PointerEvent) {
  e.preventDefault()
  capturePointer(e)
  void rec.start()
}

function onDelete(p: Pad) {
  if (confirm(p.id)) void deletePad(p)
}
</script>

<template>
  <div class="pads">
    <div v-for="p in pads" :key="p.id" class="pad-wrap">
      <button
        class="pad"
        :class="{ live: booth.pads.includes(p.id) }"
        :title="`${p.label} (${p.durationSec?.toFixed(1)} s)`"
        @pointerdown="padDown($event, p)"
        @pointermove="padMove"
        @pointerup="padUp($event, p)"
        @pointercancel="touches.delete($event.pointerId)"
        @contextmenu.prevent
      >
        <span class="pad-emoji">{{ p.emoji }}</span>
        <span class="pad-label">{{ p.label }}</span>
      </button>
      <button v-if="p.recorded" class="pad-del" :class="{ armed: armed === p.id }" :title="`Delete ${p.label}`" :aria-label="`Delete ${p.label}`" @click="onDelete(p)">{{ armed === p.id ? 'Delete?' : '✕' }}</button>
    </div>
    <form v-if="rec.take.value" class="pad rec-name" @submit.prevent="rec.save">
      <input ref="nameEl" v-model="rec.name.value" maxlength="30" aria-label="Pad name" enterkeyhint="done" :disabled="rec.saving.value">
      <span class="rec-actions">
        <button type="button" class="ghost sm" title="Discard" :disabled="rec.saving.value" @click="rec.discard">✕</button>
        <button type="submit" class="ghost sm" title="Save the pad" :disabled="rec.saving.value">{{ rec.saving.value ? '⏳' : '✓' }}</button>
      </span>
    </form>
    <button
      v-else
      class="pad rec"
      :class="{ live: rec.recording.value }"
      title="Hold and speak (4 s max): it becomes a pad, with the voice picked below"
      @pointerdown="recDown"
      @pointerup="rec.stop"
      @pointercancel="rec.stop"
      @contextmenu.prevent
    >
      <span class="pad-emoji">{{ rec.recording.value ? '⏺️' : '🔴' }}</span>
      <span class="pad-label">{{ rec.recording.value ? 'Recording…' : 'Hold to record' }}</span>
    </button>
  </div>
</template>
