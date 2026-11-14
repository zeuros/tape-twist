<script setup lang="ts">
import type { Platform } from '#shared/types/music'

/**
 * The server's login browser, shown here: frames of its tab (server/utils/remoteView.ts), and
 * this screen's taps, scrolls and typing sent back. A hidden input carries the keyboard: it is
 * focused on every tap (so the phone keyboard can open in the tap itself) and let go when the
 * server says no text field took the focus.
 */
const props = defineProps<{ platform: Platform }>()
const emit = defineEmits<{ close: [] }>()
const { loadStatus, platformState } = usePlatforms()

const img = ref<HTMLImageElement | null>(null)
const kb = ref<HTMLInputElement | null>(null)
const frame = ref('')
const size = ref({ w: 1, h: 1 })
const ended = ref<string | null>(null)
const box = loginViewSize()
let events: EventSource | null = null

const base = `/api/connect/${props.platform}`
const send = (body: object) => $fetch<{ editable?: boolean }>(`${base}/input`, { method: 'POST', body }).catch(() => null)

onMounted(() => {
  events = new EventSource(`${base}/view`)
  events.onmessage = (m) => {
    const e = JSON.parse(m.data)
    if (e.type === 'frame') {
      frame.value = `data:image/jpeg;base64,${e.data}`
      size.value = { w: e.w, h: e.h }
    } else if (e.type === 'end') {
      events?.close()
      loadStatus()
      if (e.ok) emit('close')
      else ended.value = e.message || 'Login ended'
    }
  }
})
onBeforeUnmount(() => events?.close())

function close() {
  if (!ended.value) void $fetch(`${base}/cancel`, { method: 'POST' }).catch(() => {})
  emit('close')
}

/** Page coordinates (CSS px of the remote page) of a point on the image. */
function at(ev: { clientX: number; clientY: number }) {
  const r = img.value!.getBoundingClientRect()
  return { x: ((ev.clientX - r.left) / r.width) * size.value.w, y: ((ev.clientY - r.top) / r.height) * size.value.h }
}

// ------------------------------------------------- taps and scrolling
let down: { x: number; y: number; id: number } | null = null
let scrolled = false
let wheel = { dy: 0, dx: 0 }
let wheelTimer: ReturnType<typeof setTimeout> | undefined
let lastPt = { clientX: 0, clientY: 0 }

function flushWheel() {
  wheelTimer = undefined
  if (!wheel.dx && !wheel.dy) return
  void send({ type: 'wheel', ...at(lastPt), dx: wheel.dx, dy: wheel.dy })
  wheel = { dx: 0, dy: 0 }
}
function queueWheel(dx: number, dy: number, pt: { clientX: number; clientY: number }) {
  const r = img.value!.getBoundingClientRect()
  const k = size.value.w / r.width // screen px → page px
  wheel.dx += dx * k
  wheel.dy += dy * k
  lastPt = { clientX: pt.clientX, clientY: pt.clientY }
  wheelTimer ??= setTimeout(flushWheel, 50)
}

function onDown(ev: PointerEvent) {
  down = { x: ev.clientX, y: ev.clientY, id: ev.pointerId }
  scrolled = false
  ;(ev.target as HTMLElement).setPointerCapture(ev.pointerId)
}
function onMove(ev: PointerEvent) {
  if (!down || ev.pointerId !== down.id) {
    if (ev.pointerType === 'mouse' && !down) void send({ type: 'move', ...at(ev) })
    return
  }
  const dx = ev.clientX - down.x
  const dy = ev.clientY - down.y
  if (!scrolled && Math.hypot(dx, dy) < 8) return
  scrolled = true
  queueWheel(-dx, -dy, ev) // drag up = scroll down
  down = { ...down, x: ev.clientX, y: ev.clientY }
}
async function onUp(ev: PointerEvent) {
  if (!down || ev.pointerId !== down.id) return
  down = null
  if (scrolled) return flushWheel()
  // Focus now, inside the tap: a phone only opens its keyboard from a user gesture.
  kb.value?.focus({ preventScroll: true })
  const r = await send({ type: 'click', ...at(ev) })
  if (r && r.editable === false) kb.value?.blur()
}
function onWheel(ev: WheelEvent) {
  queueWheel(ev.deltaX, ev.deltaY, ev)
}

// ------------------------------------------------------------ keyboard
// The hidden input always holds one space: typing adds after it, Backspace on an empty
// field (which phones don't report) removes it.
const SENTINEL = ' '
let composing = false

function resetKb() {
  const k = kb.value
  if (!k) return
  k.value = SENTINEL
  k.setSelectionRange(1, 1)
}
function flushText() {
  const v = kb.value?.value ?? SENTINEL
  if (v === '') void send({ type: 'key', key: 'Backspace' })
  else if (v.length > 1) void send({ type: 'text', text: v.slice(1) })
  resetKb()
}
function onInput(ev: Event) {
  if (composing || (ev as InputEvent).isComposing) return
  flushText()
}
function onCompositionEnd() {
  composing = false
  flushText()
}
const KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
function onKey(ev: KeyboardEvent) {
  if (composing || ev.isComposing || !KEYS.has(ev.key)) return
  ev.preventDefault()
  flushText()
  void send({ type: 'key', key: ev.key })
}
function showKeyboard() {
  resetKb()
  kb.value?.focus()
}
onMounted(resetKb)
</script>

<template>
  <div class="remote-login" role="dialog" :aria-label="`${PLATFORM_LABEL[platform]} login`">
    <div class="remote-login-win" :style="{ width: `${box.width}px` }">
      <div class="remote-login-bar">
        <strong>{{ PLATFORM_LABEL[platform] }} login</strong>
        <small>{{ ended ?? platformState(platform).text }}</small>
        <button class="ghost sm" title="Open the keyboard" @click="showKeyboard">⌨️</button>
        <button class="ghost sm" title="Close (cancels the login)" @click="close">✕</button>
      </div>
      <div class="remote-login-screen" :style="{ height: `${box.height}px` }">
        <img
          v-if="frame"
          ref="img"
          :src="frame"
          alt=""
          draggable="false"
          @pointerdown.prevent="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="down = null"
          @wheel.prevent="onWheel"
          @contextmenu.prevent
        />
        <p v-else class="remote-login-wait"><i class="spin" /> Starting the login browser…</p>
      </div>
      <input
        ref="kb"
        class="remote-login-kb"
        type="text"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        aria-label="Typing goes to the login page"
        @input="onInput"
        @keydown="onKey"
        @compositionstart="composing = true"
        @compositionend="onCompositionEnd"
      />
    </div>
  </div>
</template>
