<script setup lang="ts">
import type { GuestSearchItem, GuestState } from '#shared/types/engine'

/** The guest page: what's playing, what's next, and requesting / voting for songs. */
const state = ref<GuestState | null>(null)
const q = ref('')
const results = ref<GuestSearchItem[]>([])
const searching = ref(false)
const toast = ref('')
const name = ref('')
let pollTimer: ReturnType<typeof setTimeout> | undefined
let searchTimer: ReturnType<typeof setTimeout> | undefined
let fetchedAt = 0

async function poll() {
  clearTimeout(pollTimer)
  try {
    state.value = await $fetch<GuestState>('/api/guest/state')
    fetchedAt = Date.now()
  } catch {
    /* offline for a moment */
  }
  pollTimer = setTimeout(poll, document.hidden ? 15000 : 4000)
}

watch(q, (v) => {
  clearTimeout(searchTimer)
  if (!v.trim()) {
    results.value = []
    return
  }
  searching.value = true
  searchTimer = setTimeout(async () => {
    results.value = await $fetch<GuestSearchItem[]>('/api/guest/search', { query: { q: v } }).catch(() => [])
    searching.value = false
  }, 250)
})

watch(name, (v) => {
  try {
    localStorage.setItem('em-guest-name', v)
  } catch {
    /* private mode */
  }
})

function say(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 2500)
}

const requestedIds = computed(() => new Set(state.value?.requests.map((r) => r.item.id) ?? []))
const queuedIds = computed(() => new Set(state.value?.upNext.map((r) => r.id) ?? []))

async function request(item: GuestSearchItem) {
  try {
    await $fetch('/api/guest/request', { method: 'POST', body: { itemId: item.id, name: name.value } })
    say(requestedIds.value.has(item.id) ? '👍 Vote added' : '🙋 Requested! The host will see it.')
    poll()
  } catch (e: any) {
    say(e?.data?.statusMessage || 'Could not send the request')
  }
}

async function vote(id: string) {
  await $fetch('/api/guest/vote', { method: 'POST', body: { requestId: id } }).catch(() => {})
  poll()
}

const now = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | undefined
const pos = computed(() => {
  const n = state.value?.now
  if (!n) return 0
  const drift = n.status === 'playing' ? (now.value - fetchedAt) / 1000 : 0
  return Math.min(n.durSec, n.posSec + drift)
})

onMounted(() => {
  try {
    name.value = localStorage.getItem('em-guest-name') ?? ''
  } catch {
    /* private mode */
  }
  poll()
  tickTimer = setInterval(() => (now.value = Date.now()), 1000)
})
onBeforeUnmount(() => {
  clearTimeout(pollTimer)
  clearInterval(tickTimer)
})

useHead({ title: 'Evening Mix · Requests' })
</script>

<template>
  <div class="guest">
    <header class="g-top">
      <div class="brand"><span class="moon" aria-hidden="true" /> {{ state?.title || 'Evening Mix' }}</div>
    </header>

    <section class="now-card" :class="{ idle: !state?.now }">
      <template v-if="state?.now">
        <img v-if="state.now.artwork" :src="state.now.artwork" alt="">
        <div class="now-meta">
          <small>{{ state.now.status === 'playing' ? 'Now playing' : 'Paused' }}</small>
          <strong>{{ state.now.title }}</strong>
          <span>{{ state.now.artist }}</span>
          <div class="g-progress"><span :style="{ width: `${state.now.durSec ? (pos / state.now.durSec) * 100 : 0}%` }" /></div>
        </div>
      </template>
      <p v-else>The music hasn't started yet. Request something!</p>
    </section>

    <section v-if="state?.upNext.length" class="g-section">
      <h2>Up next</h2>
      <ol class="g-list">
        <li v-for="it in state.upNext" :key="it.id">
          <img v-if="it.artwork" :src="it.artwork" alt="">
          <div class="g-meta">
            <div class="title">{{ it.title }}</div>
            <div class="sub">{{ it.artist }}<template v-if="it.requestedBy"> · 🙋 {{ it.requestedBy }}</template></div>
          </div>
        </li>
      </ol>
    </section>

    <section class="g-section">
      <h2>Request a track</h2>
      <div class="g-form">
        <input v-model="q" type="search" placeholder="Search any song on Deezer…" autocomplete="off" enterkeyhint="search">
        <input v-model="name" class="g-name" placeholder="Your name (optional)" maxlength="40" autocomplete="nickname">
      </div>
      <ul v-if="q.trim()" class="g-list">
        <li v-for="it in results" :key="it.id">
          <img v-if="it.artwork" :src="it.artwork" alt="">
          <div class="g-meta">
            <div class="title">{{ it.title }}</div>
            <div class="sub"><span v-if="it.fav" class="g-fav" title="One of the host's favorites">♥</span> {{ it.artist }} · {{ formatDuration(it.durationSec, '') }}</div>
          </div>
          <button
            class="g-btn"
            :class="{ done: requestedIds.has(it.id) || queuedIds.has(it.id) }"
            :disabled="queuedIds.has(it.id)"
            @click="request(it)"
          >
            {{ queuedIds.has(it.id) ? 'Queued' : requestedIds.has(it.id) ? '👍 Vote' : 'Request' }}
          </button>
        </li>
        <li v-if="!searching && !results.length" class="g-empty">Nothing found for "{{ q }}".</li>
      </ul>
    </section>

    <section class="g-section">
      <h2>Requests <small>vote for what you want to hear</small></h2>
      <ul class="g-list">
        <li v-for="r in state?.requests ?? []" :key="r.id" :class="{ approved: r.status === 'approved' }">
          <img v-if="r.item.artwork" :src="r.item.artwork" alt="">
          <div class="g-meta">
            <div class="title">{{ r.item.title }}</div>
            <div class="sub">
              {{ r.item.artist }} · 🙋 {{ r.mine ? 'you' : r.guestName }}
              <template v-if="r.status === 'approved'"> · ✓ in the queue</template>
            </div>
          </div>
          <button v-if="r.status === 'pending'" class="g-vote" :class="{ on: r.voted }" :aria-pressed="r.voted" @click="vote(r.id)">
            👍 {{ r.votes }}
          </button>
          <span v-else class="g-vote static">👍 {{ r.votes }}</span>
        </li>
        <li v-if="!state?.requests.length" class="g-empty">No requests yet. Be the first!</li>
      </ul>
    </section>

    <div v-if="toast" class="g-toast" role="status">{{ toast }}</div>
  </div>
</template>
