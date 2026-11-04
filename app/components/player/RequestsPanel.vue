<script setup lang="ts">
/** Guest requests waiting for the host, and the recently decided ones. */
const { pending, decided, decide } = useRequests()

const { guestUrl, load } = useGuestUrl()
onMounted(load)
</script>

<template>
  <section class="panel requests">
    <div class="panel-head">
      <h2>Guest requests <span v-if="pending.length" class="count-badge">{{ pending.length }}</span></h2>
    </div>
    <p class="muted small">Guests open <strong>{{ guestUrl }}</strong> to search your favorites (or all of Deezer), request and vote.</p>
    <ul class="list">
      <li v-for="r in pending" :key="r.id" class="item">
        <img v-if="r.item.artwork" class="thumb" :src="r.item.artwork" alt="">
        <div class="meta">
          <div class="title">{{ r.item.title }}</div>
          <div class="sub">
            <PlatformBadge :platform="r.item.platform" />
            {{ r.item.artist }} · 🙋 {{ r.guestName }}
          </div>
        </div>
        <span class="votes" :title="`${r.votes} vote(s)`">👍 {{ r.votes }}</span>
        <button class="ghost sm ok-btn" title="Approve: plays after the current track" @click="decide(r, 'approve')">✓</button>
        <button class="ghost sm" title="Reject" @click="decide(r, 'reject')">✕</button>
      </li>
      <li v-if="!pending.length" class="empty">No pending requests.</li>
    </ul>
    <template v-if="decided.length">
      <h3>Recent</h3>
      <ul class="list dim">
        <li v-for="r in decided" :key="r.id" class="item">
          <div class="meta">
            <div class="title">{{ r.item.title }}</div>
            <div class="sub">{{ r.status === 'approved' ? '✓ approved' : '✕ rejected' }} · 🙋 {{ r.guestName }} · 👍 {{ r.votes }}</div>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>
