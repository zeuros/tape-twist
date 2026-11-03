<script setup lang="ts">
/** The evening's playlists, dock-style (the open one is wide), and "+" for a new one. */
const { doc, evening, playlistSec, newPlaylist } = useEvening()
const { eng } = useEngine()
const playingFrom = (items: { id: string }[]) => !!eng.value?.currentId && items.some((x) => x.id === eng.value!.currentId)
</script>

<template>
  <div class="pl-bar">
    <div class="pl-tabs" role="tablist" aria-label="Playlists">
      <button
        v-for="pl in doc.playlists"
        :key="pl.id"
        class="pl-tab"
        :class="{ on: pl.id === evening.id }"
        role="tab"
        :aria-selected="pl.id === evening.id"
        :title="`${pl.title} · ${pl.items.length} songs · ${formatDuration(playlistSec(pl)) || '0:00'}`"
        @click="doc.open = pl.id"
      >
        <span v-if="playingFrom(pl.items)" class="pl-live" title="Playing from this playlist">♪</span>
        <span class="pl-name">{{ pl.title || 'Untitled' }}</span>
      </button>
    </div>
    <button class="pl-new" title="New playlist" aria-label="New playlist" @click="newPlaylist">+</button>
  </div>
</template>
