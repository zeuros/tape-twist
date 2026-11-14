<script setup lang="ts">
/** Brand, and the SoundCloud / Deezer connections. */
const { status, loginOpen, loginView, platformState, connect } = usePlatforms()
const openLogins = computed(() => PLATFORMS.filter((p) => status.value?.[p].capture.state === 'running' && status.value[p].capture.interactive))
const { eng } = useEngine()
</script>

<template>
  <header class="top">
    <div class="brand">
      <BrandLogo :spinning="eng?.status === 'playing'" />
      <span>Tape Twist</span>
    </div>
    <div class="conns">
      <div v-for="p in PLATFORMS" :key="p" class="conn" :class="[p, platformState(p).tone]">
        <span class="dot" />
        <div class="conn-text">
          <strong>{{ PLATFORM_LABEL[p] }}</strong>
          <small :title="platformState(p).text">{{ platformState(p).text }}</small>
        </div>
        <button
          v-if="status?.[p]?.capture.state !== 'running'"
          class="ghost sm"
          :title="status?.[p]?.connected ? 'Re-capture credentials from a browser login' : 'Log in to this platform (the server\'s browser, shown here)'"
          @click="connect(p)"
        >
          {{ status?.[p]?.connected && platformState(p).tone === 'ok' ? 'Login' : 'Connect' }}
        </button>
      </div>
      <PlayerApkLink />
      <PlayerGuestQr />
    </div>
  </header>

  <p v-if="loginOpen && !loginView" class="banner">
    A login is open on the server.
    <button v-for="p in openLogins" :key="p" class="ghost sm" @click="loginView = p">Show {{ PLATFORM_LABEL[p] }} login</button>
  </p>
  <PlayerRemoteLogin v-if="loginView" :platform="loginView" @close="loginView = null" />
</template>
