# Tape Twist internals

How each part works, in detail. Setup is in the [README](../README.md).

## How credentials work

- **Connect** opens a Chromium on the server (with a saved profile in `data/profiles/<platform>`) and **shows it in the page**, sized to your screen: its tab is streamed as JPEG frames (Chrome's screencast, only when the page changes) and your taps, scrolls and typing are replayed into it (`server/utils/remoteView.ts`, `app/components/player/RemoteLogin.vue`). So you can log in from a phone, anywhere, and the server needs no screen (Docker). On a desktop the same window also opens there. Deezer and SoundCloud can't be put in an iframe, and a page couldn't read their cookies anyway: the capture has to happen on the server. You log in yourself (captcha, 2FA and Google/Apple popups included: a popup takes over the view until it closes). The app waits for the session cookie (`oauth_token` for SoundCloud, `arl` for Deezer), records the headers the site sends to its own API (plus SoundCloud's `client_id`), saves them to `data/credentials-<platform>.json`, and closes the browser. ✕ cancels.
- API calls replay those captured headers, cookies and user agent:
  - SoundCloud: `api-v2.soundcloud.com` (`/me`, `track_likes`, `playlist_likes`)
  - Deezer: `www.deezer.com/ajax/gw-light.php` (`deezer.getUserData`, `song.getFavoriteIds`, `song.getListData`, and `deezer.pageSearch` for catalog search)
  - SoundCloud catalog search: `/search/tracks` and `/search/playlists_without_albums`. The player's **Search** panel shows matching favorites first, then catalog results from both platforms (following the source and kind filters).
- When a call gets a 401 or 403, or the session token is invalid, the app first reopens the saved profile headlessly to refresh the credentials. Only if that fails does the UI ask you to **Connect** again.

## Playback

```
 Deezer / SoundCloud                 virtual sinks             ffmpeg            phone
 deck A (hidden Chromium) ──audio──▶ tape_twist_a ──┐
                                                    ├─ Node mix → MP3 ──▶ /api/stream ──▶ phone: + pads, colour, echo, EQ (Web Audio)
 deck B (hidden Chromium) ──audio──▶ tape_twist_b ──┘
```

- Each **deck** is a headless Chromium whose sound goes to its own virtual sink (`tape_twist_a` / `_b`), so nothing plays through the PC's speakers.
  - Deezer plays in a deezer.com page through its own player (`dzPlayer`), logged in with the captured cookies, so you get full tracks.
  - SoundCloud plays through the official widget API.
- **Crossfades:** the next item is preloaded on the idle deck. When the current item is `crossfade` seconds from its end, the two sinks are ramped with equal-power curves. Deezer→Deezer can't overlap (one stream per account), so it fades out, then in, on the same deck.
- **Listen here** plays the live mix on that device (`app/utils/liveAudio.ts`). Lock-screen and headset buttons control the server.
  - Chrome: `/api/stream` (MP3), fed to the `<audio>` element through Media Source Extensions.
  - Firefox and iPhones (no MP3 in Media Source Extensions): the same MP3 stream, decoded in the page by mpg123 compiled to WebAssembly (`mpg123-decoder`), frame by frame. Every frame counts 1152 samples even if it fails to decode, so the timeline never shifts; the decoder's output is 1105 samples late (LAME's encoder delay plus the decoder's), which the page takes off. The page cuts it into 0.1 s blocks and schedules each one with Web Audio at its exact time. Without WebAssembly it falls back to `/api/stream?format=pcm`, the same audio as raw 16-bit PCM (~1.5 Mbit/s per device instead of 0.2). An inaudible looping media element keeps the page alive with the screen off: Firefox on Android only keeps "real" media playing (not Web Audio, not a MediaStream).
- **Sync:** every listening device plays the same instant, 0.45 s behind the server, so several phones on several speakers sound as one.
  - The MP3 is constant bitrate (every 576-byte frame is 1152 samples), so a byte offset is a sample position. The server records when each sample was rendered on its clock and tells each new stream which sample it starts at (`x-stream-start`); `/api/clock` gives its time.
  - Each page measures its clock offset to the server (NTP-style, best of several round trips, refreshed every 10 s) and plays sample s at the agreed time, minus its own audio output latency. MP3: small errors are steered out with the element's playback rate (≤2 %), big ones (a stall) with a jump. PCM: blocks are butted together and steered with ≤0.5 % rate changes, big errors reschedule. A new stream starts from a 3–4 s backlog, so a phone joins in sync at once.
  - Tested in one machine: Chromium pages (MP3 and PCM) within ~10–20 ms of each other; Firefox (PCM) syncs too. On phones over Wi-Fi expect ~10–30 ms.
  - **Sync slider** (next to Listen, per device, remembered): plays that device earlier (or later), for speakers that add their own delay. Bluetooth speakers are often 100–300 ms late: drag until the speakers sound as one. Double-click resets it.
  - Pads, echo and your voice aren't delayed: they play at once on each device, on top of the synced music.
- PipeWire remembers one output per app name, and both decks are "Chromium". Each deck therefore tags its audio with `PULSE_PROP tape_twist.deck=a|b`, and the engine moves any stream that lands on the wrong sink back where it belongs.
- `GET /api/engine-debug` shows each deck's raw player state.
- Run `npm run start:https` from the project folder: pads are loaded from `./pads` (or `PADS_DIR`).

## Booth (effects)

The booth effects run **in each listening browser** (Web Audio, `app/utils/boothAudio.ts`), on top of the live stream, so they react at once on the device you press. Each page uses two audio contexts: the music and what changes it (echo, EQ, colour, duck) run with a ~60 ms output buffer, which survives the phone being locked (a 10–20 ms buffer crackled for a couple of seconds); pads and the Talkover voice are added on top from a separate lowest-latency context, so they stay instant (pads: ~30 ms). The server only keeps the shared booth state (`server/utils/booth.ts`) and relays every change and pad hit to all open pages over server-sent events (`/api/fx/events`), so every listening device plays the same thing within a few ms. A page that only controls (not listening) still drives the others.

The server mix (`server/utils/mixer.ts`) is just the music, as a Web Audio graph rendered natively by [node-web-audio-api](https://github.com/ircam-ismm/node-web-audio-api) (Rust): ffmpeg captures both deck sinks as raw audio, each deck goes through its bass shelf (bass swap), its platform level (Deezer boost) and its gain (crossfades are equal-power curves on the gain, sample-accurate), then a soft limiter, and a second ffmpeg encodes the MP3. The deck sinks themselves stay at 100 %. The graph is fed and read through ScriptProcessorNodes (43 ms callbacks on the main thread): this library's AudioWorklet busy-polls a whole CPU core. The whole mix uses ~2–3 % of a core and adds ~0.15 s of buffering.

- **Pads:** a 4×3 soundboard defined in `pads/pads.json` (emoji, label, mp3). Each listening page downloads and decodes them when you tap "Listen here", then plays them over the music, which ducks while one plays. Every pad toggles: tap it again while it plays to stop it. To swap a sound, drop an mp3 in `pads/`, edit the JSON and restart. Trim leading silence from new samples: it counts as latency.
- **Talkover (hold):** the music drops by the duck depth (default 10 dB) on every listening device and comes back on release. The phone re-sends "held" every 2 s, and the server releases it after 6 s of silence (in case a touch-release gets lost).
  - **Voice:** on the device you hold it on (if it's listening), your microphone plays straight into its output, funfair-tannoy style: cleaned up (low cut, presence, compressor), then a 130 ms slapback and a long bright reverb. *Voice volume* sets its level (remembered per device). Four voices, picked per device (under the pads; recorded pads use it too): 📢 tannoy (that one), 🤖 robot (ring modulator + metallic comb), 🐿️ chipmunk (+7 semitones) and 👹 monster (−6 semitones, more chest); the pitch shifts are two crossfaded sweeping delay lines (~0.1 s). It only plays on that device, not on the other listening ones. The mic needs HTTPS (see above); it opens on the first press and stays open until you stop listening.
  - **Larsen (feedback):** the mic is opened with the browser's echo cancellation and noise suppression, which remove this device's own output and steady tones from it; the low cut removes the boomy range that rings first; the mic is only live while you hold. On top of that, a feedback detector watches the voice while you talk: a single tone towering over the spectrum at the same pitch for ~0.2 s gets a narrow notch (up to 6, kept for the evening; the browser console logs `larsen at … Hz`). It still helps a lot to stand behind or beside the speaker, not in front of it, and to talk close to the mic with the voice volume no higher than needed.
- **Brake (hold):** tape stop. The music slows to a standstill (pitch dropping with it) on every listening device; let go and it spins back up and is in sync again (a growing delay line, shrunk back to 0).
- **Rewind (hold):** the music spins backwards, faster and faster (up to 3× speed, through the last ~15 s), like a selector pulling the tune up; let go and it cuts straight back in live. Same trick as Brake: a delay that grows faster than time passes.
- **Build-up (hold):** over four bars (from the measured tempo) the bass is filtered away, a noise riser climbs and a snare roll speeds up from quarters to thirty-seconds; let go for the drop: everything back at once with a sub hit and a crash.
- **Stutter (hold, slide):** the last 1, ½, ¼ or ⅛ beat loops until you let go; slide along the strip to change the length while holding. The music runs on underneath, so it comes back live.
- **Tempo:** measured on the server from the mixed music (`server/utils/tempo.ts`: kick onsets, autocorrelation over 8 s), shared with every phone so the stutter loops and the snare roll are the same length everywhere. Shown next to Stutter; 124 BPM is used while there's no clear beat.
- **Light show (💡 Lights):** the screen of every phone listening when it's switched on (the one switching it too) flashes a new colour on each kick, timed to when that phone's speaker plays it, and stays awake. A tap hides it on that phone. A phone that starts listening while it's on doesn't join in (no surprise flashing on "Listen here"); off and on again brings everyone in. It isn't saved: a restart leaves it off.
- **XY pad:** drag a finger: left sweeps a low-pass, right a high-pass, up adds resonance and echo. Let go and it snaps back. Synced to every listening device like the hold buttons.
- **Record a pad (hold the 🔴 tile):** speak up to 4 s, name it, and it becomes a 🎤 pad for everyone. It gets the voice picked under the pads (same chain as Talkover, with slapback and reverb), rendered in the browser before upload. The server trims silence and saves it as MP3 in `data/pads/` (private, with `data/recorded-pads.json`). ✕ deletes it.
- **Colour:** old radio (band-pass, drive, crackle, hiss), phone (narrow band, mono) or vinyl (crackle and warmth), cross-faded in and out.
- **EQ:** 3-band EQ on the listening devices (low shelf 200 Hz, mid 1 kHz, high shelf 3.5 kHz). The bottom of each slider is a kill.
- **Deezer level:** Deezer tracks come out of its player about 12 dB quieter than the same songs on SoundCloud (measured on 6 songs available on both: SoundCloud −7 to −16 LUFS, Deezer −20 to −24, at full player and stream volume). The server mix evens them out with a gain stage per deck (`server/utils/mixer.ts`): **−9 dB** on SoundCloud and **+3 dB** on Deezer by default. Boosting Deezer the full +11.5 dB alone saturated the mix; splitting the difference leaves headroom. Both are adjustable under *Transitions & safety*.
- **Bass swap:** during crossfades of 2 s or more, the incoming track starts without bass, and at the midpoint the basses trade places.
- **Safety:**
  - Auto-pause after N hours of continuous playback (default 6).
  - Auto-pause when nobody has listened for N minutes (default 15).
  - The hidden browsers close after 15 min without playback, which frees RAM and your Deezer session.

## Ask Claude

One line at the top of each playlist: a request ("calm bass music for ambience. go around Kebuffeule (Iorie remix)"), how many songs, ✨. The songs are placed in that playlist. Claude runs through the Claude Code CLI installed on the server machine (`claude -p`, its own login; no API key), one request at a time, Opus 5.5 at low effort (`CLAUDE_MIX_MODEL`, `CLAUDE_MIX_EFFORT`, `CLAUDE_BIN` to change). Claude first writes searches; the server gathers real SoundCloud/Deezer results plus SoundCloud's "related tracks" of the reference songs, then Claude lays out the upcoming part of the playlist: the upcoming songs are numbered `P0…`, the candidates `N0…`, and it answers with one list mixing both. So it can only name real songs; it may slot the new ones between the upcoming ones and move those when asked ("put the sea shanties together"). The server checks the answer: unknown or repeated numbers are dropped, a forgotten upcoming song goes back after the one it followed, and the songs already played (up to the one playing) never move. The page applies the layout only if the playlist didn't change while Claude was thinking; otherwise the new songs are appended. A request that only asks to rearrange skips the catalog searches. Claude's note on what it did shows under the line.

The evening list has a revision number, so two open players never silently overwrite each other.

### Reaching it from outside (Tailscale Funnel)

`tailscale funnel --bg https+insecure://localhost:3000` publishes the app at `https://<machine>.<tailnet>.ts.net`. Anyone with that link reaches the lock screen; the API needs the host PIN. Still, turn it off after the party (`tailscale funnel reset`). A visitor who opens the ts.net link from the home Wi-Fi is sent to the LAN address (`https://192.168.1.x:3000`) so the stream doesn't go out to the internet and back: Funnel passes the visitor's address, and the server compares it with the home's public IP from `tailscale netcheck`. Set `LAN_REDIRECT=0` to turn that off. The QR button in the player header shows the `/player` link as a QR code.

## Docker

```sh
npm run serve -- --docker         # rebuild + restart the container, then cycle the Funnel
docker compose up -d --build      # the same without the Funnel: https://<this-machine-ip>:3000, data in ./data
docker compose logs -f            # its output
```

One container holds everything the desktop provides otherwise (`Dockerfile`, `docker/entrypoint.sh`): a PulseAudio daemon for the decks' virtual sinks (nothing plays on the host), Xvfb as the login browser's invisible screen (you see it through **Connect**, above), ffmpeg, Playwright's Chromium, and a self-signed certificate created in `data/tls` on first start. It uses the host network, so the QR code gets the LAN address and phones reach port 3000, and a 1 GB `/dev/shm` for Chromium.

- **Tailscale:** keep the Funnel on the host (`npm run serve -- --docker` handles it). There's no `tailscale` inside, so the QR code shows the LAN address and the LAN redirect is off.
- **Ask Claude:** mount your Claude Code login (`~/.claude`, `~/.claude.json`; commented out in `docker-compose.yml`). Build with `--build-arg WITH_CLAUDE=0` to leave the CLI out.
- **Already logged in on a desktop?** Copy `data/` over: credentials and profiles work as they are.
- The container runs as uid 1000, normally the owner of `./data`.

## Project layout

```
shared/types/        types used by both sides (songs and playlists, booth, engine)
app/
  pages/             player.vue: it only puts the components together
  components/        PlatformBadge, track/ (TrackArt, TrackRow), player/ (header, search, QR link,
                     player bar), evening/ (playlists, Ask Claude, the list), booth/ (pads, holds, XY, EQ…)
  composables/       state and logic, one concern each: usePlatforms, useEvening, useEngine,
                     useListening, useBooth, useVoice (shared by the whole page),
                     useFavoriteSearch, usePadRecorder, useConfirmTap (per component)
  utils/             framework-free code: liveAudio / livePcm / pcmBlocks / pcmScheduler /
                     serverClock (synced playback),
                     boothAudio + booth/ (dsp, voice) (Web Audio effects), format, prefs
  assets/css/        base, player, booth, responsive
server/
  api/               thin routes: read the input, call server/utils
  utils/             engine, deck, mixer, booth, store; platforms (+ platformAuth,
                     soundcloud, deezer), claudeMix
```

`npm run typecheck` checks the whole project (vue-tsc). `npm test` runs the unit tests (vitest,
`test/`): stream decoding and sample numbering (with the real ffmpeg encoder when it is
installed) and the Web Audio block scheduler.

## Tests

- `npm test`: unit tests of the plain TypeScript parts (sync, MP3 blocks, tempo).
- `npm run test:e2e`: four phones messing with the booth for a minute. It builds into `.output-e2e`, starts the server on port 3190 with a temporary data folder and its own PipeWire sinks (`tape_twist_e2e_*`, removed afterwards), plays a 124 BPM test beat into deck A, and opens four browsers that listen: Chrome (MP3 through MSE), Chrome on the iPhone path (MP3 decoded in the page), Firefox, and Chrome behind a 4G-like link (30–80 ms, plus a hiccup of up to 220 ms every few seconds). Each page's audio output is tapped. They hammer pads, holds, stutter, XY, colour, EQ, lights and Listen, then it checks that no hold stays stuck, every phone still plays its music without dropouts, every pad (also a newly added one) plays on every phone, and the light show only starts on phones that were listening. Safe next to a running server. `E2E_CHAOS_SEC=20` shortens the chaos; `E2E_SEED` replays one (printed at the start).

## Notes

- Deezer may substitute a newer ID for an older favorite (same song). The deck accepts the match by ID or by title.
- Playback goes through the server because Deezer's embeddable widget only ever plays 30-second previews, even when logged in.
- `data/` holds live session tokens. It is git-ignored; keep it private.
- Tokens never reach any browser.
