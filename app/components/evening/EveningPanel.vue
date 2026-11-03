<script setup lang="ts">
/** The open playlist: its title, Ask Claude, start time, and the songs in order. */
const { doc, evening, saved, totalSec, endClock, deletePlaylist } = useEvening()
const { armed, confirm } = useConfirmTap()

function onDelete() {
  const p = evening.value
  if (!p.items.length || confirm(p.id)) deletePlaylist(p)
}
</script>

<template>
  <section class="panel evening">
    <EveningPlaylistTabs />
    <div class="panel-head">
      <input v-model="evening.title" class="ev-title" aria-label="Playlist title">
      <small class="saved">{{ saved ? 'Saved' : 'Saving…' }}</small>
      <button v-if="doc.playlists.length > 1" class="ghost sm" :class="{ danger: armed === evening.id }" :title="`Delete this playlist (${evening.items.length} songs)`" @click="onDelete">{{ armed === evening.id ? `Delete ${evening.items.length} songs?` : '🗑' }}</button>
    </div>
    <EveningAskClaude />
    <div class="ev-meta">
      <label>Starts <input v-model="evening.startTime" type="time"></label>
      <span>{{ formatDuration(totalSec) }} · ends ~{{ endClock }}</span>
    </div>
    <EveningList />
  </section>
</template>
