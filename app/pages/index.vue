<script setup lang="ts">
type Platform = 'soundcloud' | 'deezer'
interface Item {
  id: string
  title: string
  artist: string
  artwork?: string
  platform: Platform
  kind: 'track' | 'playlist'
  durationSec: number
  fav?: boolean
}
interface GuestState {
  title: string
  now: (Item & { status: string; posSec: number; durSec: number }) | null
  upNext: (Item & { requestedBy?: string })[]
  requests: { id: string; item: Item; guestName: string; votes: number; voted: boolean; mine: boolean; status: 'pending' | 'approved' }[]
}

const state = ref<GuestState | null>(null)
const q = ref('')
const results = ref<Item[]>([])
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
    results.value = await $fetch<Item[]>('/api/guest/search', { query: { q: v } }).catch(() => [])
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

async function request(item: Item) {
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

function dur(s: number) {
  if (!s) return ''
  s = Math.round(s)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`
}

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
            <div class="sub"><span v-if="it.fav" class="g-fav" title="One of the host's favorites">♥</span> {{ it.artist }} · {{ dur(it.durationSec) }}</div>
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

<style>
.guest { max-width: 640px; margin: 0 auto; padding: 16px 16px 40px; }
.g-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.now-card { display: flex; gap: 14px; align-items: center; background: var(--grad); color: var(--on-accent); border: 0; border-radius: 24px; padding: 16px; box-shadow: var(--glow), var(--shadow); }
.now-card .now-meta small, .now-card .now-meta span, .now-card.idle p { color: color-mix(in srgb, var(--on-accent) 70%, transparent); }
.now-card .g-progress { background: rgba(0,0,0,.18); }
.now-card .g-progress span { background: var(--on-accent); }
.now-card img { width: 84px; height: 84px; border-radius: 16px; box-shadow: 0 8px 18px rgba(0,0,0,.3); object-fit: cover; flex: none; }
.now-card.idle p { margin: 0; color: var(--muted); }
.now-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.now-meta small { color: var(--accent); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
.now-meta strong { font-size: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.now-meta span { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-progress { height: 4px; background: var(--line); border-radius: 2px; margin-top: 8px; overflow: hidden; }
.g-progress span { display: block; height: 100%; background: var(--accent); transition: width 1s linear; }
.g-section { margin-top: 22px; }
.g-section h2 { font-size: 15px; margin: 0 0 10px; }
.g-section h2 small { color: var(--muted); font-weight: 400; margin-left: 6px; }
.g-form { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.g-form input { background: #1c1d21; border: 0; box-shadow: inset 0 2px 4px rgba(0,0,0,.35); border-radius: 999px; padding: 12px 16px; min-width: 0; }
.g-form input:focus { outline: 2px solid color-mix(in srgb, var(--accent) 60%, transparent); outline-offset: -1px; }
.g-name { font-size: 14px; }
.g-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.g-list li { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 18px; background: var(--panel); border: 0; box-shadow: var(--shadow); }
.g-list li.approved { opacity: .65; }
.g-list img { width: 44px; height: 44px; border-radius: 12px; object-fit: cover; flex: none; }
.g-meta { flex: 1; min-width: 0; }
.g-btn { border: 0; color: var(--on-accent); background: var(--grad); box-shadow: var(--glow); border-radius: 999px; padding: 7px 12px; font-size: 13px; font-weight: 600; flex: none; white-space: nowrap; }
.g-btn.done { background: var(--panel-2); box-shadow: none; color: var(--text); }
.g-vote { border: 0; background: var(--panel-2); border-radius: 999px; padding: 7px 12px; font-size: 14px; flex: none; }
.g-vote.on { background: var(--grad); color: var(--on-accent); }
.g-vote.static { border: 0; background: none; color: var(--muted); }
.g-fav { color: var(--accent); }
.g-empty { color: var(--muted); justify-content: center; padding: 18px !important; background: none !important; }
.g-toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--grad); color: var(--on-accent); font-weight: 600; border: 0; padding: 10px 16px; border-radius: 999px; box-shadow: 0 8px 30px rgba(0,0,0,.4); white-space: nowrap; max-width: calc(100% - 32px); overflow: hidden; text-overflow: ellipsis; }
</style>
