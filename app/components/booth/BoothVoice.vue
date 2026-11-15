<script setup lang="ts">
/**
 * The Voice section: the voice to use on the left, one big hold button on the right. It talks
 * over the music (Talkover), or, with "Record a pad" ticked, records a pad with that voice
 * (4 s max), named right below once let go.
 */
const { booth, held, holdStart, holdEnd } = useBooth()
const { voicePreset, setPreset } = useVoice()
const preset = computed({ get: () => voicePreset.value, set: setPreset })
const rec = usePadRecorder()
const recordMode = ref(false)
const nameEl = ref<HTMLInputElement | null>(null)
watch(rec.take, (t) => t && nextTick(() => nameEl.value?.select()))

const on = computed(() => (recordMode.value ? rec.recording.value : !!(held.talkover || booth.value.talkover)))

function down(e: PointerEvent) {
  capturePointer(e)
  if (recordMode.value) void rec.start()
  else holdStart('talkover')
}
function up() {
  if (recordMode.value) rec.stop()
  else holdEnd('talkover')
}
// Switching while held: let go of whatever the button was doing.
watch(recordMode, (r) => (r ? holdEnd('talkover') : rec.stop()))
</script>

<template>
  <div class="voice-line">
    <BoothVoiceMatrix v-model="preset" />
    <button
      class="hold talk-big"
      :class="{ on, recording: recordMode }"
      :title="
        recordMode
          ? 'Hold and speak (4 s max): it becomes a pad for everyone, with the voice picked here'
          : 'Hold: the music drops and your voice (this device\'s mic) plays with the voice picked here, on every listening device'
      "
      @pointerdown.prevent="down"
      @pointerup="up"
      @pointercancel="up"
      @contextmenu.prevent
    >
      <template v-if="recordMode">{{ rec.recording.value ? '⏺️' : '🔴' }} <span>{{ rec.recording.value ? 'Recording…' : 'Record' }}</span></template>
      <template v-else>🎙️ <span>Talkover</span></template>
      <small>hold</small>
    </button>
  </div>
  <form v-if="rec.take.value" class="rec-name" @submit.prevent="rec.save">
    <input ref="nameEl" v-model="rec.name.value" maxlength="30" aria-label="Pad name" enterkeyhint="done" :disabled="rec.saving.value">
    <button type="button" class="ghost sm" title="Discard" :disabled="rec.saving.value" @click="rec.discard">✕</button>
    <button type="submit" class="ghost sm" title="Save the pad" :disabled="rec.saving.value">{{ rec.saving.value ? '⏳' : '✓ Save pad' }}</button>
  </form>
  <label v-else class="check rec-mode">
    <input v-model="recordMode" type="checkbox">
    <span>🔴 Record a pad instead <small>(hold the button, 4 s max)</small></span>
  </label>
</template>
