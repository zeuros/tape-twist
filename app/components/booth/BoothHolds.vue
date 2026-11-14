<script setup lang="ts">
/** Hold buttons: they act while pressed, on every listening device. */
const { booth, held, holdStart, holdEnd } = useBooth()

type Name = 'talkover' | 'brake' | 'rewind' | 'build'
const HOLDS: { name: Name; emoji: string; label: string; title: string }[] = [
  { name: 'talkover', emoji: '🎙️', label: 'Talkover', title: "Hold: the music drops and your voice (this device's mic) plays with reverb" },
  { name: 'brake', emoji: '🛑', label: 'Brake', title: 'Hold: the music slows down to a stop like a turntable; let go to spin it back up' },
  { name: 'rewind', emoji: '⏪', label: 'Rewind', title: 'Hold: the music spins backwards, faster and faster; let go to drop back in' },
  { name: 'build', emoji: '🚀', label: 'Build-up', title: 'Hold: the bass fades away, a riser and a snare roll climb for four bars; let go for the drop' },
]

function down(name: Name, e: PointerEvent) {
  capturePointer(e)
  holdStart(name)
}
</script>

<template>
  <div class="holds">
    <button
      v-for="h in HOLDS"
      :key="h.name"
      class="hold"
      :class="{ on: held[h.name] || booth[h.name] }"
      :title="h.title"
      @pointerdown.prevent="down(h.name, $event)"
      @pointerup="holdEnd(h.name)"
      @pointercancel="holdEnd(h.name)"
      @contextmenu.prevent
    >
      {{ h.emoji }} <span>{{ h.label }}</span><small>hold</small>
    </button>
  </div>
</template>
