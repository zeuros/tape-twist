<script setup lang="ts">
/** Hold buttons: they act while pressed, on every listening device (Talkover is in BoothVoice). */
const { booth, held, holdStart, holdEnd } = useBooth()

type Name = 'brake' | 'rewind' | 'build' | 'lights' | 'gate' | 'slowmo' | 'flanger' | 'siren' | 'scratch' | 'warble' | 'throw' | 'pitchUp' | 'pitchDown'
const HOLDS: { name: Name; emoji: string; label: string; title: string }[] = [
  { name: 'brake', emoji: '🛑', label: 'Brake', title: 'Hold: the music slows down to a stop like a turntable; let go to spin it back up' },
  { name: 'rewind', emoji: '⏪', label: 'Rewind', title: 'Hold: the music spins backwards, faster and faster; let go to drop back in' },
  { name: 'build', emoji: '🚀', label: 'Build-up', title: 'Hold: the bass fades away, a riser and a snare roll climb for four bars; let go for the drop' },
  { name: 'slowmo', emoji: '🐌', label: 'Slow-mo', title: 'Hold: the music slows to 70 % speed, lower and lazier; let go and it speeds back up' },
  { name: 'scratch', emoji: '🎚️', label: 'Scratch', title: 'Hold: the record is scratched back and forth, one stroke per beat; let go to drop back in' },
  { name: 'gate', emoji: '🫨', label: 'Gater', title: 'Hold: the music is chopped on 1/16 notes, in tempo' },
  { name: 'flanger', emoji: '🌀', label: 'Flanger', title: 'Hold: a jet sweep over the music, deeper the longer you hold' },
  { name: 'warble', emoji: '🌊', label: 'Tape warble', title: 'Hold: the music wobbles like a stretched tape, more and more seasick; let go and it straightens' },
  { name: 'throw', emoji: '🎯', label: 'Echo throw', title: 'Hold: the beat is caught into a long echo while the music drops out; let go and it comes back as the echoes trail off' },
  { name: 'siren', emoji: '🚨', label: 'Dub siren', title: 'Hold: a dub siren whoops once per beat, with its own echo; let go and the echoes ring out' },
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
