<script setup lang="ts">
import type { Platform } from '#shared/types/music'

defineProps<{ platform: Platform }>()
</script>

<template>
  <span class="badge" :class="platform">{{ PLATFORM_SHORT[platform] }}</span>
</template>
