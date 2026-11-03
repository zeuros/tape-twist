<template>
  <NuxtPage />
</template>

<style>
:root {
  color-scheme: dark;
  --bg: #14111a;
  --panel: #1d1924;
  --panel-2: #262130;
  --line: #342d40;
  --text: #ede6f3;
  --muted: #9b90a8;
  --accent: #f0a868;
  --sc: #ff7a2f;
  --dz: #a238ff;
  --ok: #6fcf97;
  --bad: #ef6f6c;
  --m-chill: #6cb4c9;
  --m-feels: #e88aa8;
  --m-groove: #f0a868;
  --m-deep: #7f6ad6;
  --m-winddown: #8fa58a;
  --radius: 10px;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); }
body { font: 15px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; }
button, input, select { font: inherit; color: inherit; }
button { cursor: pointer; }
button:disabled { cursor: default; opacity: .45; }

.shell { max-width: 1280px; margin: 0 auto; padding: 16px; }
.shell { padding-bottom: 120px; }

.top { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 20px; letter-spacing: -.01em; }
.moon { width: 18px; height: 18px; border-radius: 50%; box-shadow: inset -5px -2px 0 0 var(--accent); transform: rotate(-20deg); }
.conns { display: flex; flex-wrap: wrap; gap: 8px; }
.conn { display: flex; align-items: center; gap: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 6px 8px 6px 12px; min-width: 0; }
.conn-text { display: flex; flex-direction: column; min-width: 0; }
.conn-text small { color: var(--muted); max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; }
.conn.ok .dot { background: var(--ok); }
.conn.bad .dot { background: var(--bad); }
.conn.busy .dot { background: var(--accent); animation: pulse 1s infinite alternate; }
@keyframes pulse { to { opacity: .3; } }

.banner { background: color-mix(in srgb, var(--accent) 15%, var(--panel)); border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); padding: 10px 14px; border-radius: var(--radius); margin: 0 0 14px; }

.ghost { background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; text-decoration: none; }
.ghost:hover:not(:disabled) { border-color: var(--muted); }
.sm { padding: 4px 9px; font-size: 13px; }
.btn { display: inline-block; }
.link { background: none; border: 0; color: var(--accent); text-decoration: underline; padding: 0 4px; }

.tabs { display: none; gap: 6px; margin-bottom: 12px; }
.tabs button { flex: 1; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 9px; }
.tabs button.on { border-color: var(--accent); color: var(--accent); }
.tabs span { color: var(--muted); margin-left: 4px; }

.cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 14px; min-width: 0; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.panel h2 { margin: 0; font-size: 17px; }
.refresh { display: flex; gap: 6px; flex-wrap: wrap; }
.err { color: var(--bad); margin: 0 0 8px; font-size: 14px; }

.filters { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.filters input, .filters select, .ev-meta input { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; min-width: 0; }
.filters input:focus, .ev-title:focus, .ev-meta input:focus { outline: 2px solid color-mix(in srgb, var(--accent) 60%, transparent); outline-offset: -1px; }
.filters .row { display: flex; gap: 6px; }
.filters .row select { flex: 1; }
.count { color: var(--muted); }

.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.catalog-head { font-size: 13px; margin: 14px 4px 6px; }
.catalog-head small { color: var(--muted); font-weight: 400; margin-left: 6px; }
.item { display: flex; align-items: center; gap: 10px; padding: 6px; border-radius: 8px; }
.item:hover { background: var(--panel-2); }
.art { position: relative; width: 44px; height: 44px; flex: none; border: 0; border-radius: 6px; padding: 0; overflow: hidden; background: var(--panel-2); }
.art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.art .play { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.45); opacity: 0; transition: opacity .15s; font-size: 14px; }
.art:hover .play, .art:focus-visible .play { opacity: 1; }
.meta { flex: 1; min-width: 0; }
.title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub { color: var(--muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.badge { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .04em; padding: 1px 5px; border-radius: 4px; margin-right: 4px; vertical-align: 1px; }
.badge.soundcloud { background: color-mix(in srgb, var(--sc) 25%, transparent); color: var(--sc); }
.badge.deezer { background: color-mix(in srgb, var(--dz) 28%, transparent); color: #c98bff; }
.badge.set { background: var(--panel-2); color: var(--muted); }
.dur { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; flex: none; }
.add { width: 32px; height: 32px; flex: none; border-radius: 50%; border: 1px solid var(--line); background: var(--panel-2); font-size: 18px; line-height: 1; }
.add:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.empty { color: var(--muted); padding: 24px 8px; text-align: center; }
.more { width: 100%; margin-top: 8px; }

.ev-title { flex: 1; min-width: 0; background: transparent; border: 0; border-radius: 6px; font-size: 17px; font-weight: 700; padding: 2px 4px; }
.saved { color: var(--muted); }
.ev-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; color: var(--muted); margin-bottom: 10px; }
.ev-meta label { display: flex; align-items: center; gap: 8px; }
.ev-meta input { padding: 4px 8px; }
.arc { display: flex; height: 10px; border-radius: 5px; overflow: hidden; gap: 2px; margin-bottom: 12px; }
.arc span { min-width: 3px; }
.ev { align-items: flex-start; cursor: grab; }
.ev.dragging { opacity: .4; }
.ev.current { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.time { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; width: 40px; flex: none; padding-top: 12px; }
.moods { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.mood { border: 1px solid var(--line); background: transparent; border-radius: 999px; padding: 1px 9px; font-size: 12px; color: var(--muted); }
.mood.on { color: #14111a; border-color: transparent; font-weight: 600; }
.ops { display: flex; gap: 4px; flex: none; }

.m-chill { background: var(--m-chill); }
.m-feels { background: var(--m-feels); }
.m-groove { background: var(--m-groove); }
.m-deep { background: var(--m-deep); }
.m-winddown { background: var(--m-winddown); }
.m-none { background: var(--line); }
.mood:not(.on) { background: transparent; }

.remote { position: fixed; left: 0; right: 0; bottom: 0; z-index: 10; background: color-mix(in srgb, var(--panel) 96%, transparent); backdrop-filter: blur(8px); border-top: 1px solid var(--line); }
.progress { height: 4px; background: var(--line); position: relative; }
.progress.seekable { cursor: pointer; }
.progress.seekable:hover { height: 8px; margin-top: -4px; }
.progress span { position: absolute; inset: 0 auto 0 0; background: var(--accent); transition: width .2s linear; }
.remote-row { max-width: 1280px; margin: 0 auto; padding: 10px 16px; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 14px; }
.now { display: flex; align-items: center; gap: 10px; min-width: 0; }
.now img { width: 44px; height: 44px; border-radius: 6px; object-fit: cover; flex: none; }
.now-text { min-width: 0; }
.idle { white-space: normal; }
.fading { color: var(--accent); }
.transport { display: flex; align-items: center; gap: 8px; }
.round { width: 40px; height: 40px; border-radius: 50%; padding: 0; display: grid; place-items: center; }
.primary { background: var(--accent); color: #1a1208; border: 0; width: 48px; height: 48px; font-size: 16px; font-weight: 700; }
.extras { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px 12px; }
.xfade small { opacity: .8; }
.xfade { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; white-space: nowrap; }
.xfade input { width: 90px; accent-color: var(--accent); }
.listen { border: 1px solid var(--line); background: var(--panel-2); border-radius: 999px; padding: 8px 14px; white-space: nowrap; }
.listen.on { border-color: var(--ok); color: var(--ok); }
.listen.connecting { border-color: var(--accent); color: var(--accent); }
.remote-err { max-width: 1280px; margin: 0 auto; padding: 0 16px 8px; }


/* ---------------------------------------------------------------- booth */
.side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.panel h3 { margin: 18px 0 8px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); display: flex; align-items: center; gap: 8px; }
.panel h3 small { text-transform: none; letter-spacing: 0; }
.pads { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.pad { aspect-ratio: 1 / .9; border: 1px solid var(--line); border-radius: 12px; background: var(--panel-2); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 6px 4px; touch-action: manipulation; user-select: none; -webkit-user-select: none; transition: transform .06s, border-color .15s, box-shadow .15s; }
.pad:active { transform: scale(.94); }
.pad:hover { border-color: var(--muted); }
.pad.live { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent), 0 0 18px color-mix(in srgb, var(--accent) 30%, transparent); }
.pad-emoji { font-size: 28px; line-height: 1; }
.pad-label { font-size: 11px; color: var(--muted); text-align: center; line-height: 1.15; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.holds { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
.hold { border: 1px solid var(--line); border-radius: 12px; background: var(--panel-2); padding: 10px 6px; display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 20px; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.hold span { font-size: 13px; }
.hold small { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.hold.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 18%, var(--panel-2)); }
.seg { display: flex; flex-wrap: wrap; gap: 6px; }
.seg button { flex: 1 1 auto; border: 1px solid var(--line); background: var(--panel-2); border-radius: 999px; padding: 6px 10px; font-size: 13px; white-space: nowrap; }
.seg button.on { border-color: var(--accent); color: var(--accent); }
.eq { display: flex; flex-direction: column; gap: 6px; }
.eq label { display: grid; grid-template-columns: 44px minmax(0, 1fr) 56px; align-items: center; gap: 8px; }
.eq-name { color: var(--muted); font-size: 13px; }
.eq-val { font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }
.eq-val.kill { color: var(--bad); font-weight: 600; }
input[type=range] { accent-color: var(--accent); width: 100%; min-width: 0; }
.slider-row { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); margin-top: 10px; }
.settings .check { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.settings .check input { accent-color: var(--accent); width: 16px; height: 16px; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
.count-badge { display: inline-block; min-width: 18px; padding: 0 6px; border-radius: 999px; background: var(--accent); color: #1a1208 !important; font-size: 11px; font-weight: 700; line-height: 18px; text-align: center; margin-left: 4px; }
.badge.req { background: color-mix(in srgb, var(--ok) 20%, transparent); color: var(--ok); margin-left: 6px; }
.thumb { width: 40px; height: 40px; border-radius: 6px; object-fit: cover; flex: none; }
.votes { font-size: 13px; color: var(--muted); white-space: nowrap; flex: none; }
.ok-btn:hover { border-color: var(--ok); color: var(--ok); }
.dim { opacity: .6; }

.moon.big { width: 34px; height: 34px; box-shadow: inset -9px -4px 0 0 var(--accent); }
.primary-btn { width: 100%; background: var(--accent); color: #1a1208; border: 0; border-radius: 10px; padding: 11px; font-weight: 700; }

@media (min-width: 1200px) {
  .shell { max-width: 1600px; }
  .cols { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(320px, 400px); }
  .remote-row { max-width: 1600px; }
}
@media (min-width: 861px) and (max-width: 1199px) {
  .side { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; }
}

@media (max-width: 860px) {
  .tabs { display: flex; }
  .cols { grid-template-columns: minmax(0, 1fr); }
  .panel.hidden, .side.hidden { display: none; }
  .tabs button { padding: 9px 4px; font-size: 14px; }
  .conns { width: 100%; flex-wrap: nowrap; }
  .conn { flex: 1; gap: 8px; padding-left: 10px; }
  .conn button { white-space: nowrap; }
  .conn-text small { max-width: 100%; }
  .ops { flex-direction: column; }
  .time { width: 34px; }
  .remote-row { grid-template-columns: minmax(0, 1fr) auto; gap: 8px 10px; padding: 8px 12px; }
  .extras { grid-column: 1 / -1; justify-content: space-between; }
  /* Sync slider: its own full-width row, so it can be set to a few ms. */
  .xfade.ahead { flex: 1 1 100%; }
  .xfade.ahead span { min-width: 6.5em; font-variant-numeric: tabular-nums; white-space: normal; }
  .xfade.ahead small { display: block; }
  .xfade.ahead input { flex: 1; width: auto; min-width: 0; height: 28px; }
  .shell { padding-bottom: 200px; }
}
</style>
