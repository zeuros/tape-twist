<script setup lang="ts">
/**
 * The open playlist's songs with their start times. Reorder by dragging (mouse) or with the
 * ⠿ handle (touch: HTML5 drag-and-drop doesn't exist on phones), or with ↑ ↓.
 */
const { evening, schedule, removeAt, moveTo, swap } = useEvening()
const { eng, loadingItem } = useEngine()
const dragFrom = ref<number | null>(null)

function onDrop(to: number) {
  const from = dragFrom.value
  dragFrom.value = null
  if (from !== null) moveTo(from, to)
}

// Touch: the handle follows the finger; the item moves as soon as it's over another entry.
function handleDown(e: PointerEvent, i: number) {
  e.preventDefault()
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  dragFrom.value = i
  navigator.vibrate?.(10)
}
function handleMove(e: PointerEvent) {
  const from = dragFrom.value
  if (from === null) return
  // Scroll when the finger nears the top, or the player bar at the bottom.
  if (e.clientY < 70) window.scrollBy(0, -14)
  else if (e.clientY > window.innerHeight - 190) window.scrollBy(0, 14)
  const li = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('li.ev')
  const to = Number(li?.dataset.i)
  if (!li || Number.isNaN(to) || to === from) return
  moveTo(from, to)
  dragFrom.value = to
}
const handleUp = () => (dragFrom.value = null)
</script>

<template>
  <ol class="list ev-list">
    <li
      v-for="(it, i) in evening.items"
      :key="it.id"
      class="item ev"
      :class="{ dragging: dragFrom === i, current: eng?.currentId === it.id, loading: loadingItem?.id === it.id }"
      draggable="true"
      :data-i="i"
      @dragstart="dragFrom = i"
      @dragover.prevent
      @drop="onDrop(i)"
    >
      <span
        class="handle"
        title="Drag to reorder"
        @pointerdown="handleDown($event, i)"
        @pointermove="handleMove"
        @pointerup="handleUp"
        @pointercancel="handleUp"
      >⠿</span>
      <span class="time">{{ formatClock(schedule[i]!) }}</span>
      <TrackArt :item="it" :title="`Play from ${it.title}`" />
      <div class="meta">
        <div class="title">{{ it.title }}</div>
        <div class="sub">
          <PlatformBadge :platform="it.platform" />
          {{ it.artist }} · {{ formatDuration(it.durationSec) }}
        </div>
      </div>
      <div class="ops">
        <button class="ghost sm" title="Move up" :disabled="i === 0" @click="swap(i, -1)">↑</button>
        <button class="ghost sm" title="Move down" :disabled="i === evening.items.length - 1" @click="swap(i, 1)">↓</button>
        <button class="ghost sm" title="Remove" @click="removeAt(i)">✕</button>
      </div>
    </li>
    <li v-if="!evening.items.length" class="empty">Add favorites with + and arrange them here.</li>
  </ol>
</template>
