<script setup lang="ts">
/** Search: the host's favorites (filtered, sorted), then the same words on both catalogs. */
const { status, allFavs, favErr, favLoading, loadFavs, connect } = usePlatforms()
const { q, source, kind, sort, shown, filtered, catalogShown, catalogLoading } = useFavoriteSearch()
</script>

<template>
  <section class="panel favs">
    <div class="panel-head">
      <h2>Search</h2>
      <div class="refresh">
        <button
          v-for="p in PLATFORMS"
          :key="p"
          class="ghost sm"
          :disabled="favLoading[p] || !status?.[p]?.connected"
          :title="`Last fetched ${timeAgo(status?.[p]?.favorites?.fetchedAt)}`"
          @click="loadFavs(p, true)"
        >
          {{ favLoading[p] ? 'Loading…' : `↻ ${PLATFORM_LABEL[p]}` }}
        </button>
      </div>
    </div>
    <p v-for="p in PLATFORMS" v-show="favErr[p]" :key="p" class="err">
      {{ PLATFORM_LABEL[p] }}: {{ favErr[p] }}
      <button v-if="favErr[p] === 'Login required'" class="link" @click="connect(p)">Connect</button>
    </p>

    <div class="filters">
      <input v-model="q" type="search" placeholder="Search your favorites and all of SoundCloud and Deezer…" autocomplete="off">
      <div class="row">
        <select v-model="source" aria-label="Source">
          <option value="all">All sources</option>
          <option value="soundcloud">SoundCloud</option>
          <option value="deezer">Deezer</option>
        </select>
        <select v-model="kind" aria-label="Kind">
          <option value="all">Everything</option>
          <option value="track">Tracks</option>
          <option value="playlist">Playlists / sets</option>
          <option value="long">Long mixes (20 min+)</option>
        </select>
        <select v-model="sort" aria-label="Sort">
          <option value="added">Recently liked</option>
          <option value="title">Title</option>
          <option value="artist">Artist</option>
          <option value="duration">Longest</option>
        </select>
      </div>
      <small class="count">{{ filtered.length }} of {{ allFavs.length }} favorites</small>
    </div>

    <ul class="list">
      <TrackRow v-for="f in filtered.slice(0, shown)" :key="f.id" :item="f" />
      <li v-if="!allFavs.length" class="empty">
        {{ PLATFORMS.some((p) => favLoading[p]) ? 'Loading favorites…' : 'Connect a platform to see your favorites.' }}
      </li>
    </ul>
    <button v-if="filtered.length > shown" class="ghost more" @click="shown += 300">
      Show more ({{ filtered.length - shown }} left)
    </button>
    <template v-if="q.trim().length >= 2 && (catalogShown.length || catalogLoading)">
      <h3 class="catalog-head">
        On {{ source === 'all' ? 'SoundCloud and Deezer' : PLATFORM_LABEL[source] }}
        <small>{{ catalogLoading ? 'searching…' : 'not in your favorites' }}</small>
      </h3>
      <ul class="list">
        <TrackRow v-for="f in catalogShown" :key="f.id" :item="f" />
      </ul>
    </template>
  </section>
</template>
