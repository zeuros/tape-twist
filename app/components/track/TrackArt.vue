<script setup lang="ts">
import type { FavItem } from '#shared/types/music'

/** Cover that plays the item when tapped (a spinner while it's being opened). */
const props = defineProps<{ item: FavItem }>()
const { loadingItem, playNow } = useEngine()
const loading = computed(() => loadingItem.value?.id === props.item.id)
</script>

<template>
  <button class="art" :class="{ loading }" @click="playNow(item)">
    <img v-if="item.artwork" :src="item.artwork" alt="" loading="lazy">
    <span class="play"><i v-if="loading" class="spin" /><template v-else>▶</template></span>
  </button>
</template>
