<script setup lang="ts">
/** Brand, and the SoundCloud / Deezer connections. */
const { status, loginOpen, platformState, connect } = usePlatforms()
</script>

<template>
  <header class="top">
    <div class="brand">
      <span class="moon" aria-hidden="true" />
      <span>Evening Mix</span>
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
          :title="status?.[p]?.connected ? 'Re-capture credentials from a browser login' : 'Open a browser on the host to log in'"
          @click="connect(p)"
        >
          {{ status?.[p]?.connected && platformState(p).tone === 'ok' ? 'Login' : 'Connect' }}
        </button>
      </div>
    </div>
  </header>

  <p v-if="loginOpen" class="banner">
    A browser window opened on the machine running this app. Log in there and it closes by itself once the credentials are captured.
  </p>
</template>
