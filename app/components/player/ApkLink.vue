<script setup lang="ts">
/** Download button for the Android app, shown in a browser when the server has an APK. */
const apk = ref<{ available: boolean; size?: number } | null>(null)
const title = computed(() =>
  `Download the Android app${apk.value?.size ? ` (${(apk.value.size / 1048576).toFixed(1)} MB)` : ''}`,
)
onMounted(async () => {
  if (isNative()) return // already in the app
  apk.value = await $fetch<{ available: boolean; size?: number }>('/api/apk').catch(() => null)
})
</script>

<template>
  <a v-if="apk?.available" class="qr-btn" href="/tape-twist.apk" download="tape-twist.apk" :title="title" :aria-label="title">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.6 9.48l1.84-3.18a.38.38 0 0 0-.66-.38l-1.86 3.22A11.4 11.4 0 0 0 12 8.2c-1.76 0-3.42.34-4.92.94L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48A10.8 10.8 0 0 0 1 18h22a10.8 10.8 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z" />
    </svg>
  </a>
</template>
