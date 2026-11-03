<script setup lang="ts">
import type { FavItem } from '#shared/types/music'

/** A search result: play it now, or add it to the open playlist. */
const props = defineProps<{ item: FavItem }>()
const { inEvening, add } = useEvening()
const added = computed(() => inEvening.value.has(props.item.id))
</script>

<template>
  <li class="item">
    <TrackArt :item="item" :title="`Play ${item.title} now`" />
    <div class="meta">
      <div class="title">{{ item.title }}</div>
      <div class="sub">
        <PlatformBadge :platform="item.platform" />
        <span v-if="item.kind === 'playlist'" class="badge set">set · {{ item.trackCount }}</span>
        {{ item.artist }}
      </div>
    </div>
    <span class="dur">{{ formatDuration(item.durationSec) }}</span>
    <button class="add" :disabled="added" :title="added ? 'In the evening' : 'Add to the evening'" @click="add(item)">
      {{ added ? '✓' : '+' }}
    </button>
  </li>
</template>
