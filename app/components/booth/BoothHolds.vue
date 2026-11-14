<script setup lang="ts">
/** Hold buttons: they act while pressed, on every listening device. */
const { booth, held, holdStart, holdEnd } = useBooth()

type Name = 'talkover' | 'brake' | 'rewind' | 'build' | 'lights' | 'pitchUp' | 'pitchDown'
const HOLDS: { name: Name; emoji: string; label: string; title: string }[] = [
  { name: 'talkover', emoji: '🎙️', label: 'Talkover', title: "Hold: the music drops and your voice (this device's mic) plays with reverb, on every listening device" },
  { name: 'brake', emoji: '🛑', label: 'Brake', title: 'Hold: the music slows down to a stop like a turntable; let go to spin it back up' },
  { name: 'rewind', emoji: '⏪', label: 'Rewind', title: 'Hold: the music spins backwards, faster and faster; let go to drop back in' },
  { name: 'build', emoji: '🚀', label: 'Build-up', title: 'Hold: the bass fades away, a riser and a snare roll climb for four bars; let go for the drop' },
  { name: 'lights', emoji: '💡', label: 'Lights', title: "Hold: every listening phone's screen (this one too) flashes a new colour on each kick" },
]

function down(name: Name, e: PointerEvent) {
  capturePointer(e)
  holdStart(name)
}
const PITCH = [
  { name: 'pitchDown', sign: '▼', label: 'Pitch down', title: 'Hold: the music bends down, lower and lower; let go and it glides back' },
  { name: 'pitchUp', sign: '▲', label: 'Pitch up', title: 'Hold: the music bends up, higher and higher; let go and it glides back' },
] as const
const pitchOn = computed(() => !!(held.pitchUp || held.pitchDown || booth.value.pitchUp || booth.value.pitchDown))
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
    <div class="pitch" :class="{ shifted: pitchOn }">
      <template v-for="(p, k) in PITCH" :key="p.name">
        <span v-if="k === 1" class="pitch-val"><span>Pitch</span><small>hold</small></span>
        <button
          class="pitch-btn"
          :class="{ on: held[p.name] || booth[p.name] }"
          :title="p.title"
          :aria-label="p.label"
          @pointerdown.prevent="down(p.name, $event)"
          @pointerup="holdEnd(p.name)"
          @pointercancel="holdEnd(p.name)"
          @contextmenu.prevent
        >
          {{ p.sign }}
        </button>
      </template>
    </div>
  </div>
</template>
