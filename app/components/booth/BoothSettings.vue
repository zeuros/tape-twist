<script setup lang="ts">
/** Transitions & safety: the engine's settings, plus how far the music ducks. */
import { DEFAULT_ENGINE_SETTINGS } from '#shared/types/engine'
import { DEFAULT_DUCK_DB } from '#shared/types/booth'

/** The settings this section shows (crossfade length lives elsewhere, so it's left alone). */
const KEYS = ['bassSwap', 'soundcloudLevelDb', 'deezerBoostDb', 'autoPauseHours', 'idlePauseMin'] as const

const { eng, setSetting } = useEngine()
const { booth, setFxValue } = useBooth()
const num = (e: Event) => Number((e.target as HTMLInputElement).value)
const dbLabel = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} dB`

function reset() {
  for (const k of KEYS) setSetting(k, DEFAULT_ENGINE_SETTINGS[k])
  if (booth.value.duckDb !== DEFAULT_DUCK_DB) setFxValue('duck', DEFAULT_DUCK_DB)
}
</script>

<template>
  <h3>
    Transitions & safety
    <button v-if="eng" class="link" title="Back to the default values" @click="reset">reset</button>
  </h3>
  <div v-if="eng" class="settings">
    <label class="check">
      <input type="checkbox" :checked="eng.settings.bassSwap" @change="setSetting('bassSwap', ($event.target as HTMLInputElement).checked)">
      Bass swap during crossfades
    </label>
    <label class="slider-row" title="SoundCloud tracks are mastered loud: bringing them down leaves headroom so the mix doesn't saturate">
      <span>SoundCloud level: {{ dbLabel(eng.settings.soundcloudLevelDb ?? 0) }}</span>
      <input type="range" min="-18" max="6" step="0.5" :value="eng.settings.soundcloudLevelDb ?? 0" @input="setSetting('soundcloudLevelDb', num($event))">
    </label>
    <label class="slider-row" title="Deezer tracks play quieter than SoundCloud ones: this evens them out">
      <span>Deezer level: +{{ eng.settings.deezerBoostDb ?? 0 }} dB</span>
      <input type="range" min="0" max="18" step="0.5" :value="eng.settings.deezerBoostDb ?? 0" @input="setSetting('deezerBoostDb', num($event))">
    </label>
    <label class="slider-row">
      <span>Talkover / pad duck: −{{ booth.duckDb }} dB</span>
      <input type="range" min="3" max="24" step="1" :value="booth.duckDb" @change="setFxValue('duck', num($event))">
    </label>
    <label class="slider-row">
      <span>Auto-pause after {{ eng.settings.autoPauseHours ? `${eng.settings.autoPauseHours} h` : 'never' }}</span>
      <input type="range" min="0" max="12" step="1" :value="eng.settings.autoPauseHours" @input="setSetting('autoPauseHours', num($event))">
    </label>
    <label class="slider-row">
      <span>Pause when nobody listens for {{ eng.settings.idlePauseMin ? `${eng.settings.idlePauseMin} min` : 'never' }}</span>
      <input type="range" min="0" max="60" step="5" :value="eng.settings.idlePauseMin" @input="setSetting('idlePauseMin', num($event))">
    </label>
  </div>
</template>
