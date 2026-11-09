<script setup lang="ts">
/** The floating player bar: progress, now playing, transport, crossfade, Listen here, sync. */
const { eng, busy, command, loadingItem, togglePlay, shownPos, setCrossfade } = useEngine()
const listen = useListening()
const { listening, audioState, lag, ahead, syncLabel, setAhead, autoSync } = listen
const { evening } = useEvening()
const num = (e: Event) => Number((e.target as HTMLInputElement).value)

/** Where the bar is being dragged to (0–1), or null when not dragging: the bar follows it, the seek happens on release. */
const drag = ref<number | null>(null)
const track = ref<HTMLElement>()
const seekable = computed(() => !!(eng.value?.current && eng.value.durSec))
const fraction = computed(() => drag.value ?? (eng.value?.durSec ? Math.min(1, shownPos.value / eng.value.durSec) : 0))

function at(ev: PointerEvent) {
  const r = track.value!.getBoundingClientRect()
  return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width))
}
function seekStart(ev: PointerEvent) {
  if (!seekable.value || ev.button > 0) return
  capturePointer(ev)
  drag.value = at(ev)
}
function seekMove(ev: PointerEvent) {
  if (drag.value !== null) drag.value = at(ev)
}
async function seekEnd(ev: PointerEvent) {
  if (drag.value === null) return
  const f = at(ev)
  drag.value = f
  await command('seek', { value: f * eng.value!.durSec })
  drag.value = null
}
function seekCancel() {
  drag.value = null
}
</script>

<template>
  <footer class="remote">
    <audio
      :ref="listen.setElement"
      preload="none"
      @playing="audioState = 'on'"
      @error="listen.onTrouble"
      @ended="listen.onTrouble"
    />
    <div
      class="progress"
      :class="{ seekable, dragging: drag !== null }"
      role="slider"
      aria-label="Position"
      :aria-valuenow="Math.round(fraction * (eng?.durSec || 0))"
      :aria-valuemax="Math.round(eng?.durSec || 0)"
      @pointerdown="seekStart"
      @pointermove="seekMove"
      @pointerup="seekEnd"
      @pointercancel="seekCancel"
    >
      <div ref="track" class="progress-track">
        <span class="progress-fill" :style="{ width: `${fraction * 100}%` }" />
        <i v-if="seekable" class="progress-ring" :style="{ left: `${fraction * 100}%` }" />
      </div>
    </div>
    <div class="remote-row">
      <div class="now">
        <template v-if="eng?.current">
          <img v-if="eng.current.artwork" :src="eng.current.artwork" alt="">
          <div class="now-text">
            <div class="title">
              <PlatformBadge :platform="eng.current.platform" />
              {{ eng.current.title }}
            </div>
            <div class="sub">
              {{ eng.current.artist }} · {{ formatDuration(Math.floor(shownPos)) }} / {{ formatDuration(Math.round(eng.durSec)) }}
              <span v-if="loadingItem && loadingItem.id !== eng.currentId" class="loading-note"> · <i class="spin" /> loading {{ loadingItem.title }}…</span>
              <span v-else-if="eng.fading" class="fading">crossfading…</span>
              <span v-else-if="eng.next"> · next: {{ eng.next.title }}</span>
            </div>
          </div>
        </template>
        <template v-else-if="loadingItem">
          <span class="now-art-wrap"><img v-if="loadingItem.artwork" :src="loadingItem.artwork" alt=""><i class="spin" /></span>
          <div class="now-text">
            <div class="title">{{ loadingItem.title }}</div>
            <div class="sub loading-note">{{ loadingItem.artist }} · starting…</div>
          </div>
        </template>
        <div v-else class="sub idle">
          {{ evening.items.length ? 'Ready. Press play to start the evening.' : 'Add favorites to the evening, then press play.' }}
        </div>
      </div>

      <div class="transport">
        <button class="ghost round" title="Previous" :disabled="busy || !eng?.current" @click="command('prev')">⏮</button>
        <button class="primary round" :class="{ disco: eng?.status === 'playing' }" :title="eng?.status === 'playing' ? 'Pause' : 'Play'" :disabled="busy && eng?.status !== 'playing'" @click="togglePlay">
          <i v-if="loadingItem && eng?.status !== 'playing'" class="spin" />
          <template v-else-if="eng?.status === 'playing'"><span class="disco-ball" aria-hidden="true">🪩</span><span class="disco-pause" aria-hidden="true">❚❚</span></template>
          <template v-else>▶</template>
        </button>
        <button class="ghost round" title="Next" :disabled="busy || !eng?.next" @click="command('next')">⏭</button>
      </div>

      <div class="extras">
        <label class="xfade" title="Crossfade length between items">
          <span>Fade {{ eng?.crossfade ?? 6 }}s</span>
          <input type="range" min="0" max="12" step="1" :value="eng?.crossfade ?? 6" @input="setCrossfade(num($event))">
        </label>
        <button
          class="listen"
          :class="audioState"
          :title="listening ? `Stop listening on this device (${syncLabel}${lag != null ? `, ${lag.toFixed(1)} s behind the server` : ''})` : 'Play the evening on this device, in sync with the other listening devices'"
          @click="listening ? listen.stop() : listen.start()"
        >
          {{ audioState === 'on' ? '🔊 Listening' : audioState === 'connecting' ? '… Connecting' : '🎧 Listen here' }}
        </button>
        <label
          v-if="listening"
          class="xfade ahead"
          title="Play this device earlier, to catch up with the others when its speaker adds delay (Bluetooth: often 100–300 ms). Drag until the speakers sound as one."
        >
          <span>{{ ahead > 0 ? 'Ahead' : ahead < 0 ? 'Behind' : 'Sync' }} {{ Math.round(Math.abs(ahead) * 1000) }} ms<small v-if="autoSync.note"> · {{ autoSync.note }}</small><small v-else-if="syncLabel"> · {{ syncLabel }}</small></span>
          <input type="range" :min="AHEAD_MIN" :max="AHEAD_MAX" step="0.005" :value="ahead" :disabled="autoSync.busy" @input="setAhead(num($event))" @dblclick="setAhead(0)">
          <button
            class="ghost auto-sync"
            :disabled="autoSync.busy || audioState !== 'on'"
            title="Auto-sync: this device goes quiet for ~8 s, listens to the other speakers with the mic, plays a few short beeps to time its own speaker, then sets the slider. Hold it where you'll listen."
            @click.prevent="listen.runAutoSync()"
          >
            <i v-if="autoSync.busy" class="spin" /><template v-else>🎯 Auto</template>
          </button>
        </label>
      </div>
    </div>
    <p v-if="eng?.error" class="err remote-err">{{ eng.error }}</p>
    <p v-else-if="eng?.notice" class="muted remote-err">{{ eng.notice }}</p>
  </footer>
</template>
