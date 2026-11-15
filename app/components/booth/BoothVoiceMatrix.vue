<script setup lang="ts">
import type { VoicePreset } from '#shared/types/booth'

/** The voice characters, four by two: for Talkover (BoothVoice) and for a pad being recorded. */
const model = defineModel<VoicePreset>({ required: true })
const voices = VOICES.map((v) => {
  const [emoji, ...name] = v.label.split(' ')
  return { id: v.id, emoji, name: name.join(' ') }
})
</script>

<template>
  <div class="voice-matrix" role="group" aria-label="Voice">
    <button v-for="v in voices" :key="v.id" type="button" :class="{ on: model === v.id }" @click="model = v.id">
      <span class="vm-emoji">{{ v.emoji }}</span><span class="vm-name">{{ v.name }}</span>
    </button>
  </div>
</template>
