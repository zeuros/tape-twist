<script setup lang="ts">
/**
 * The app: search, the evening's playlists and the booth, with the player bar at the bottom.
 * On a phone the three panels are tabs.
 */
const platforms = usePlatforms()
const { evening, reload: loadEvening } = useEvening()
const engine = useEngine()
const booth = useBooth()
const listen = useListening()

const tab = ref<'favs' | 'evening' | 'booth'>('favs')
/** Host PIN entered on this device? null while checking (nothing mounts or fetches until it's known). */
const unlocked = ref<boolean | null>(null)
const pinLength = ref(4)

onMounted(async () => {
  const auth = await $fetch<{ ok: boolean; length: number }>('/api/auth').catch(() => null)
  if (auth?.length) pinLength.value = auth.length
  unlocked.value = !!auth?.ok
  if (!unlocked.value) return
  await nextTick() // the panels mount now
  await platforms.start()
  await loadEvening()
  engine.start()
  document.addEventListener('visibilitychange', listen.onVisible)
  await booth.start()
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', listen.onVisible)
  listen.close()
  booth.stop()
  platforms.stop()
  engine.stop()
})
</script>

<template>
  <PlayerPinGate v-if="unlocked === false" :length="pinLength" />
  <div v-else-if="unlocked" class="shell">
    <PlayerHeader />

    <nav class="tabs">
      <button :class="{ on: tab === 'favs' }" @click="tab = 'favs'">Search <span>{{ platforms.allFavs.value.length }}</span></button>
      <button :class="{ on: tab === 'evening' }" @click="tab = 'evening'">Evening <span>{{ evening.items.length }}</span></button>
      <button :class="{ on: tab === 'booth' }" @click="tab = 'booth'">Booth</button>
    </nav>

    <main class="cols">
      <PlayerSearchPanel :class="{ hidden: tab !== 'favs' }" />
      <EveningPanel :class="{ hidden: tab !== 'evening' }" />
      <BoothPanel :class="{ hidden: tab !== 'booth' }" />
    </main>

    <PlayerRemoteBar />
    <BoothLightShow />
  </div>
</template>
