<script setup lang="ts">
import type { Pad } from '#shared/types/booth'

/** The soundboard, and the tile that records a new pad (then asks its name inline). */
const { booth, pads, hitPad, deletePad, reloadPads, showFxError } = useBooth()
const builtIn = computed(() => pads.value.filter((p) => !p.recorded))
const custom = computed(() => pads.value.filter((p) => p.recorded))
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

// myinstants.com: an empty field opens the site to pick a sound; a pasted link becomes a pad.
const instantUrl = ref('')
const adding = ref(false)
async function addInstant() {
  const url = instantUrl.value.trim()
  if (!url) return void window.open('https://www.myinstants.com/', '_blank', 'noopener')
  if (!/myinstants\.com\//i.test(url)) return showFxError('Paste a myinstants.com link (an instant page or its .mp3).')
  adding.value = true
  try {
    await $fetch('/api/pads/instant', { method: 'POST', body: { url } })
    instantUrl.value = ''
    await reloadPads()
  } catch (e: any) {
    showFxError(e?.data?.statusMessage || 'Could not add that sound')
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <div class="pads">
    <div v-for="p in builtIn" :key="p.id" class="pad-wrap">
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
    </div>
    <div class="pads-sep" role="separator"><span>Yours</span></div>
    <div v-for="p in custom" :key="p.id" class="pad-wrap">
      <button
        class="pad"
        :class="{ live: booth.pads.includes(p.id), tinted: p.color }"
        :style="p.color ? { '--pad-color': p.color } : undefined"
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
    <form class="instant-add" @submit.prevent="addInstant">
      <input v-model="instantUrl" type="text" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="Paste a myinstants.com link" aria-label="myinstants link" enterkeyhint="go" :disabled="adding">
      <button type="submit" class="ghost sm" :disabled="adding" :title="instantUrl.trim() ? 'Add this sound as a pad' : 'Open myinstants.com to find a sound'">
        {{ adding ? '⏳ Adding…' : instantUrl.trim() ? '➕ Add' : '🔎 myinstants' }}
      </button>
    </form>
  </div>
</template>
