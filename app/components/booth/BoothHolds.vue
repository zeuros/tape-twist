<script setup lang="ts">
/** Talkover and Brake work while held; Echo out is a tap. */
const { booth, held, holdStart, holdEnd, echoOut } = useBooth()
const { eng } = useEngine()

function down(name: 'talkover' | 'brake', e: PointerEvent) {
  capturePointer(e)
  holdStart(name)
}
</script>

<template>
  <div class="holds">
    <button
      class="hold"
      :class="{ on: held.talkover || booth.talkover }"
      title="Hold: the music drops and your voice (this device's mic) plays with reverb"
      @pointerdown.prevent="down('talkover', $event)"
      @pointerup="holdEnd('talkover')"
      @pointercancel="holdEnd('talkover')"
      @contextmenu.prevent
    >
      🎙️ <span>Talkover</span><small>hold</small>
    </button>
    <button class="hold" title="Echo the current track out and bring in the next one" :disabled="eng?.status !== 'playing'" @click="echoOut">
      🌀⏭ <span>Echo out</span><small>tap</small>
    </button>
    <button
      class="hold"
      :class="{ on: held.brake || booth.brake }"
      title="Hold: the music slows down to a stop like a turntable; let go to spin it back up"
      @pointerdown.prevent="down('brake', $event)"
      @pointerup="holdEnd('brake')"
      @pointercancel="holdEnd('brake')"
      @contextmenu.prevent
    >
      🛑 <span>Brake</span><small>hold</small>
    </button>
  </div>
</template>
