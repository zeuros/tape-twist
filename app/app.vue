<template>
  <NuxtPage />
</template>

<style>
:root {
  color-scheme: dark;
  --bg: #1b1c20;
  --panel: #26272c;
  --panel-2: #313238;
  --line: #3b3c43;
  --text: #f4f2ef;
  --muted: #9d9ba3;
  --accent: #ff9a1f;
  --accent-2: #ffb547;
  --on-accent: #1d1206;
  --grad: linear-gradient(135deg, var(--accent-2), var(--accent) 55%, #f47b0c);
  --shadow: 0 18px 40px -12px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.25);
  --glow: 0 10px 24px -8px color-mix(in srgb, var(--accent) 70%, transparent);
  --sc: #ff7a2f;
  --dz: #a238ff;
  --ok: #6fcf97;
  --bad: #ef6f6c;
  --m-chill: #6cb4c9;
  --m-feels: #e88aa8;
  --m-groove: #ffb547;
  --m-deep: #7f6ad6;
  --m-winddown: #8fa58a;
  --radius: 16px;
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

/* Ask Claude: one line (request + count + go), method chips under it */
.ai-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.ai-prompt { flex: 1; min-width: 0; border: 0; border-radius: 999px; padding: 10px 14px; background: #1c1d21; box-shadow: inset 0 2px 4px rgba(0,0,0,.35); font-size: 14px; }
.ai-count { flex: none; width: 52px; border: 0; border-radius: 999px; padding: 10px 6px; text-align: center; background: #1c1d21; box-shadow: inset 0 2px 4px rgba(0,0,0,.35); font-size: 14px; -moz-appearance: textfield; }
.ai-count::-webkit-inner-spin-button, .ai-count::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.ai-prompt:focus, .ai-count:focus { outline: 2px solid color-mix(in srgb, var(--accent) 60%, transparent); outline-offset: -1px; }
.ai-go { flex: none; width: 40px; height: 40px; border: 0; border-radius: 50%; padding: 0; font-size: 18px; background: var(--grad); box-shadow: var(--glow); }
.ai-go:disabled { opacity: .5; box-shadow: none; }
.ai-status { display: block; margin: -2px 6px 12px; color: var(--muted); font-size: 12px; line-height: 1.35; }
.ai-status.busy { color: var(--accent); }
/* Playlists: horizontal tabs, dock-style: the open one is wide, the others squeeze to share the rest */
.pl-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.pl-tabs { flex: 1; min-width: 0; display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: #1c1d21; box-shadow: inset 0 2px 4px rgba(0,0,0,.35); }
.pl-tab { flex: 1 1 0; min-width: 10px; display: flex; align-items: center; justify-content: safe center; gap: 4px; overflow: hidden; border: 0; border-radius: 999px; padding: 8px 6px; font-size: 13px; color: var(--muted); background: var(--panel-2); transition: flex-grow .25s ease, background .2s, color .2s; }
.pl-tab:hover { color: var(--text); background: color-mix(in srgb, var(--accent) 12%, var(--panel-2)); }
.pl-tab.on { flex-grow: 4; min-width: min(55%, 9em); padding: 8px 12px; color: var(--on-accent); font-weight: 700; background: var(--grad); box-shadow: var(--glow); }
.pl-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-tab:not(.on) .pl-name { text-overflow: clip; }
.pl-live { flex: none; color: var(--accent); }
.pl-tab.on .pl-live { color: var(--on-accent); }
.pl-new { flex: none; width: 36px; height: 36px; border-radius: 50%; border: 0; padding: 0; font-size: 20px; line-height: 1; font-weight: 700; color: var(--on-accent); background: var(--grad); box-shadow: var(--glow); }
.ev-title { flex: 1; min-width: 0; background: transparent; border: 0; border-radius: 6px; font-size: 17px; font-weight: 700; padding: 2px 4px; }
.saved { color: var(--muted); }
.ev-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; color: var(--muted); margin-bottom: 10px; }
.ev-meta label { display: flex; align-items: center; gap: 8px; }
.ev-meta input { padding: 4px 8px; }
.arc { display: flex; height: 10px; border-radius: 5px; overflow: hidden; gap: 2px; margin-bottom: 12px; }
.arc span { min-width: 3px; }
.ev { align-items: flex-start; }
.ev.dragging { opacity: .4; }
.ev.current { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.handle { flex: none; align-self: stretch; display: grid; place-items: center; width: 28px; margin: -7px 0 -7px -7px; color: var(--muted); font-size: 18px; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; border-radius: 14px 0 0 14px; }
.handle:hover, .ev.dragging .handle { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.ev.dragging { opacity: 1 !important; background: color-mix(in srgb, var(--accent) 18%, var(--panel-2)); box-shadow: 0 10px 24px rgba(0,0,0,.45); }
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
.holds { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
@media (max-width: 520px) { .holds { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.pad-wrap { position: relative; display: grid; min-width: 0; }
.pad-wrap .pad { min-width: 0; }
.pad-del { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; font-size: 11px; line-height: 1; color: var(--muted); background: rgba(0,0,0,.35); }
.pad-del:hover { color: var(--text); background: rgba(0,0,0,.6); }
.ghost.sm.danger { color: #fff; background: #c0392b; white-space: nowrap; }
.pad-del.armed { width: auto; padding: 0 8px; border-radius: 999px; color: #fff; background: #c0392b; font-size: 11px; font-weight: 600; }
.pad.rec-name { display: flex; flex-direction: column; justify-content: center; gap: 6px; padding: 8px; }
.rec-name input { width: 100%; min-width: 0; border: 0; border-radius: 999px; padding: 6px 10px; font-size: 13px; text-align: center; background: #1c1d21; box-shadow: inset 0 2px 4px rgba(0,0,0,.35); }
.rec-actions { display: flex; justify-content: center; gap: 6px; }
.pad.rec { touch-action: none; -webkit-touch-callout: none; }
.voice-seg { margin-top: 8px; }
/* XY pad: a touch square, filter on x, resonance + echo on y */
.xy { position: relative; margin-top: 12px; aspect-ratio: 16 / 10; border-radius: 18px; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; cursor: crosshair;
  background: radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 70%), linear-gradient(90deg, color-mix(in srgb, var(--accent) 14%, var(--panel-2)), var(--panel-2) 45% 55%, color-mix(in srgb, var(--accent-2) 14%, var(--panel-2)));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.05), inset 0 0 0 1px var(--line); }
.xy::before { content: ''; position: absolute; inset: 0 45%; border-inline: 1px dashed color-mix(in srgb, var(--muted) 35%, transparent); pointer-events: none; }
.xy.on { box-shadow: var(--glow), inset 0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent); }
.xy span { position: absolute; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; pointer-events: none; }
.xy-l { left: 10px; bottom: 8px; }
.xy-r { right: 10px; bottom: 8px; }
.xy-t { left: 50%; top: 8px; transform: translateX(-50%); white-space: nowrap; }
.xy .xy-dot { width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; background: var(--grad); box-shadow: var(--glow), 0 0 30px color-mix(in srgb, var(--accent) 60%, transparent); }
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

/* ------------------------------------------------- theme: charcoal + orange */
html { background: var(--bg); }
body {
  min-height: 100vh;
  background:
    radial-gradient(60vmax 45vmax at 105% 0%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%),
    radial-gradient(55vmax 40vmax at -10% 105%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 60%),
    linear-gradient(160deg, #2b2d33, var(--bg) 60%);
  background-attachment: fixed;
  font-weight: 450;
}
h2, .brand, .ev-title { font-weight: 800; letter-spacing: -.02em; }
.brand { font-size: 22px; }

.panel, .conn { border: 0; border-radius: 24px; box-shadow: var(--shadow), inset 0 1px 0 rgba(255,255,255,.04); }
.panel { padding: 18px; }
.conn { border-radius: 18px; }
.banner { border-radius: 18px; border: 0; background: color-mix(in srgb, var(--accent) 16%, var(--panel)); box-shadow: var(--shadow); }

/* Buttons: pills; filled orange for the main action, dark for the rest */
.ghost { border: 0; border-radius: 999px; background: var(--panel-2); padding: 7px 14px; box-shadow: inset 0 1px 0 rgba(255,255,255,.05); }
.ghost:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 14%, var(--panel-2)); color: var(--accent-2); }
.primary, .primary-btn, .count-badge { background: var(--grad); color: var(--on-accent); box-shadow: var(--glow); }
.primary-btn { border-radius: 999px; padding: 13px; }
.round { border-radius: 50%; }
.add { border: 0; background: var(--panel-2); }
.add:hover:not(:disabled) { background: var(--grad); color: var(--on-accent); }
.listen { border: 0; background: #f4f2ef; color: #1b1c20; font-weight: 700; padding: 9px 16px; }
.listen.on { background: var(--grad); color: var(--on-accent); box-shadow: var(--glow); }
.listen.connecting { background: color-mix(in srgb, var(--accent) 25%, var(--panel-2)); color: var(--accent-2); }

/* Segmented controls: selected = orange fill */
.tabs { background: var(--panel); border-radius: 999px; padding: 5px; box-shadow: var(--shadow); }
.tabs button { border: 0; border-radius: 999px; background: transparent; font-weight: 600; }
.tabs button.on { background: var(--grad); color: var(--on-accent); box-shadow: var(--glow); }
.tabs button.on span { color: inherit; opacity: .7; }
.seg button { border: 0; background: var(--panel-2); font-weight: 600; }
.seg button.on { background: var(--grad); color: var(--on-accent); }

/* Inputs: dark inset wells */
.filters input, .filters select, .ev-meta input { border: 0; border-radius: 14px; background: #1c1d21; box-shadow: inset 0 2px 4px rgba(0,0,0,.35); padding: 10px 14px; }
.filters select { border-radius: 999px; }

/* Lists */
.item { border-radius: 14px; padding: 7px; }
.item:hover { background: var(--panel-2); }
.art, .now img, .thumb { border-radius: 10px; }
.ev.current { background: color-mix(in srgb, var(--accent) 14%, var(--panel-2)); box-shadow: inset 3px 0 0 var(--accent); }
.arc { height: 12px; border-radius: 999px; }
.mood { border: 0; background: var(--panel-2) !important; }
.mood.on { background: initial; }
.mood.on.m-chill { background: var(--m-chill) !important; }
.mood.on.m-feels { background: var(--m-feels) !important; }
.mood.on.m-groove { background: var(--m-groove) !important; }
.mood.on.m-deep { background: var(--m-deep) !important; }
.mood.on.m-winddown { background: var(--m-winddown) !important; }

/* Booth: pads are dark tiles; a playing pad lights up orange */
.pad { border: 0; border-radius: 18px; background: var(--panel-2); box-shadow: inset 0 1px 0 rgba(255,255,255,.05); }
.pad:hover { background: color-mix(in srgb, var(--accent) 10%, var(--panel-2)); border-color: transparent; }
.pad.live { background: var(--grad); box-shadow: var(--glow), 0 0 26px color-mix(in srgb, var(--accent) 45%, transparent); }
.pad.live .pad-label { color: var(--on-accent); font-weight: 600; }
.hold { border: 0; border-radius: 18px; background: var(--panel-2); box-shadow: inset 0 1px 0 rgba(255,255,255,.05); }
.hold.on { background: var(--grad); color: var(--on-accent); box-shadow: var(--glow); }
.hold.on small { color: var(--on-accent); }
.panel h3 { color: var(--accent-2); }

/* Player bar: floating dock */
.remote { left: 10px; right: 10px; bottom: 10px; border: 0; border-radius: 24px; overflow: hidden; background: color-mix(in srgb, #202125 88%, transparent); backdrop-filter: blur(14px); box-shadow: 0 20px 50px -10px rgba(0,0,0,.7); }
.progress { background: #3a3b42; }
.progress span { background: var(--grad); }

@media (max-width: 860px) {
  .remote { left: 6px; right: 6px; bottom: 6px; border-radius: 20px; }
  .panel { border-radius: 20px; padding: 14px; }
}
</style>
