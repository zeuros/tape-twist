<script setup lang="ts">
/** The booth: pads, voice, holds, XY pad, colour, EQ and the engine's safety settings. */
const { booth, fxError, stopPads, setFxValue, setColor } = useBooth()
const { voicePreset, voiceVolume, setPreset, setVolume } = useVoice()
const COLORS = [
  { id: 'off', label: 'Clean', emoji: '✨' },
  { id: 'radio', label: 'Old radio', emoji: '📻' },
  { id: 'phone', label: 'Phone', emoji: '☎️' },
  { id: 'vinyl', label: 'Vinyl', emoji: '💿' },
] as const
const num = (e: Event) => Number((e.target as HTMLInputElement).value)
</script>

<template>
  <section class="panel booth">
    <div class="panel-head">
      <h2>Booth</h2>
      <span class="panel-actions">
        <button class="ghost sm" :disabled="!booth.pads.length" @click="stopPads">Stop pads</button>
      </span>
    </div>
    <p v-if="fxError" class="err">{{ fxError }}</p>

    <BoothPads />
    <div class="seg voice-seg" role="group" aria-label="Voice for Talkover and recorded pads" title="Your voice, for Talkover and for the pads you record">
      <button v-for="v in VOICES" :key="v.id" :class="{ on: voicePreset === v.id }" @click="setPreset(v.id)">{{ v.label }}</button>
    </div>
    <label class="slider-row">
      <span>Pads volume</span>
      <input type="range" min="0" max="1.5" step="0.05" :value="booth.padVolume" @change="setFxValue('padVolume', num($event))">
    </label>

    <BoothHolds />
    <BoothStutter />
    <BoothXyPad />

    <label class="slider-row">
      <span>Voice volume</span>
      <input type="range" min="0" max="2" step="0.05" :value="voiceVolume" @change="setVolume(num($event))">
    </label>

    <h3>Colour</h3>
    <div class="seg">
      <button v-for="c in COLORS" :key="c.id" :class="{ on: booth.color === c.id }" @click="setColor(c.id)">
        {{ c.emoji }} {{ c.label }}
      </button>
    </div>

    <BoothEq />

    <BoothSettings />
  </section>
</template>
