<script setup lang="ts">
import type { FavItem } from '#shared/types/music'

/** One line at the top of the playlist: Claude finds songs, they're added to that playlist. */
const { evening, append } = useEvening()
const prompt = ref('')
const count = ref(Number(readPref('aiCount')) || 10)
const busy = ref(false)
const status = ref('')
watch(count, (v) => writePref('aiCount', String(v)))

async function ask() {
  const text = prompt.value.trim()
  if (!text || busy.value) return
  const target = evening.value
  busy.value = true
  status.value = 'Claude is choosing…'
  try {
    const r = await $fetch<{ items: FavItem[]; note: string; ms: number }>('/api/ai/mix', {
      method: 'POST',
      body: {
        prompt: text,
        count: Math.max(1, Math.min(40, count.value || 10)),
        playlistTitle: target.title,
        current: target.items.map((i) => ({ artist: i.artist, title: i.title })),
      },
    })
    const added = append(target.id, r.items)
    status.value = `+${added} in ${(r.ms / 1000).toFixed(0)} s${r.note ? ` · ${r.note}` : ''}`
  } catch (e: any) {
    status.value = errorMessage(e, 'Claude failed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="ai-row" @submit.prevent="ask">
    <input
      v-model="prompt"
      class="ai-prompt"
      :disabled="busy"
      placeholder="Ask Claude: calm bass music for ambience, go around Kebuffeule (Iorie remix)"
      aria-label="Ask Claude for songs"
      enterkeyhint="send"
      maxlength="300"
    >
    <input v-model.number="count" class="ai-count" type="number" min="1" max="40" inputmode="numeric" aria-label="How many songs" title="How many songs">
    <button class="ai-go" type="submit" :disabled="busy || !prompt.trim()" :title="busy ? 'Claude is choosing…' : 'Add songs'">{{ busy ? '⏳' : '✨' }}</button>
  </form>
  <small v-if="status" class="ai-status" :class="{ busy }">{{ status }}</small>
</template>
