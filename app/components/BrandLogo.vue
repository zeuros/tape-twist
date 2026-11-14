<script setup lang="ts">
/** The Tape Twist mark: two cassette reels and a beak. The reels turn while music plays. */
defineProps<{ spinning?: boolean }>()

const TEETH = [30, 90, 150, 210, 270, 330]
</script>

<template>
  <svg class="logo" :class="{ spinning }" viewBox="0 0 71.4 42.6" aria-hidden="true">
    <rect x="29" y="13.75" width="13.4" height="2.5" fill="currentColor" />
    <g v-for="cx in [15, 56.4]" :key="cx" :transform="`translate(${cx} 15)`">
      <g class="reel">
        <circle r="11.75" fill="none" stroke="currentColor" stroke-width="6.5" />
        <rect v-for="a in TEETH" :key="a" x="-1.25" y="-8.8" width="2.5" height="2.9" rx=".3" fill="currentColor" :transform="`rotate(${a})`" />
      </g>
    </g>
    <polygon points="28.6,31.1 42.8,31.1 35.7,40.7" fill="var(--beak)" stroke="var(--beak)" stroke-width="1.6" stroke-linejoin="round" />
  </svg>
</template>

<style scoped>
.logo { --beak: #ff7385; height: 22px; width: auto; flex: none; color: var(--text); }
.reel { animation: reel-turn 2.4s linear infinite paused; }
.spinning .reel { animation-play-state: running; }
@keyframes reel-turn { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .reel { animation: none; } }
</style>
