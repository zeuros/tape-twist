<script setup lang="ts">
/** Master EQ on the listening devices; the bottom of each slider is a kill. */
const { booth, setEq, resetEq } = useBooth()
const BANDS = [
  { id: 'low', label: 'Low' },
  { id: 'mid', label: 'Mid' },
  { id: 'high', label: 'High' },
] as const
const label = (v: number) => (v <= -26 ? 'kill' : `${v > 0 ? '+' : ''}${v} dB`)
</script>

<template>
  <h3>
    EQ <small>(master)</small>
    <button class="link" @click="resetEq">reset</button>
  </h3>
  <div class="eq">
    <label v-for="b in BANDS" :key="b.id">
      <span class="eq-name">{{ b.label }}</span>
      <input
        type="range" min="-26" max="6" step="1"
        :value="booth.eq[b.id]"
        @input="setEq(b.id, Number(($event.target as HTMLInputElement).value))"
        @dblclick="setEq(b.id, 0)"
      >
      <span class="eq-val" :class="{ kill: booth.eq[b.id] <= -26 }">{{ label(booth.eq[b.id]) }}</span>
    </label>
  </div>
</template>
