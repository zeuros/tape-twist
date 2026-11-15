<script setup lang="ts">
/** Talkover's line: the voice to talk with on the left, the Talkover hold on the right (also in the holds). */
const { booth, held, holdStart, holdEnd } = useBooth()
const { voicePreset, setPreset } = useVoice()
const preset = computed({ get: () => voicePreset.value, set: setPreset })

function down(e: PointerEvent) {
  capturePointer(e)
  holdStart('talkover')
}
</script>

<template>
  <div class="voice-line">
    <BoothVoiceMatrix v-model="preset" />
    <button
      class="hold talk-big"
      :class="{ on: held.talkover || booth.talkover }"
      title="Hold: the music drops and your voice (this device's mic) plays with the voice picked here, on every listening device"
      @pointerdown.prevent="down"
      @pointerup="holdEnd('talkover')"
      @pointercancel="holdEnd('talkover')"
      @contextmenu.prevent
    >
      🎙️ <span>Talkover</span><small>hold</small>
    </button>
  </div>
</template>
