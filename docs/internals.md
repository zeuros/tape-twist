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
  - Every browser fetches `/api/stream` (MP3) and decodes it with mpg123 compiled to WebAssembly (`mpg123-decoder`), frame by frame, in a worker (`app/workers/mp3Stream.ts`): the page's own work can't hold the blocks back. (Chrome used to play it through an `<audio>` element and Media Source Extensions: the page could only steer that player from outside, and on Android it paused and jumped whenever the stream ran late.) Every frame counts 1152 samples even if it fails to decode, so the timeline never shifts; the decoder's output is 1105 samples late (LAME's encoder delay plus the decoder's), which the page takes off. The worker cuts it into 0.1 s blocks and hands them straight (over a `MessageChannel`, past the page's main thread) to an AudioWorklet (`app/workers/livePlayer.worklet.ts`, logic in `app/utils/livePlayerCore.ts`) that plays them as one continuous stream: the page only tells it, ten times a second, which stream sample plays at which context time, and it steers there by playing up to ±0.5 % faster or slower (interpolated, so no seam), or jumps when off by over 30 ms. A missing block plays as silence instead of cutting the next one. (Before: one Web Audio source per block, scheduled from the page: a late block lost its start, and each rate change left a seam.) An inaudible looping media element keeps the page alive with the screen off and the lock-screen controls up: Android only keeps "real" media playing (not Web Audio, not a MediaStream).
  - A watchdog keeps it audible: a suspended audio context is resumed; when every block arrives already over, the clock link is measured again; when that fails, or the context's clock freezes, the contexts are rebuilt (as Listen pressed by hand does). The sync note's tooltip shows the context state and the late blocks dropped.
- **Sync:** every listening device plays the same instant, 0.55 s behind the server, so several phones on several speakers sound as one.
  - The MP3 is constant bitrate (every 576-byte frame is 1152 samples), so a byte offset is a sample position. The server records when each sample was rendered on its clock and tells each new stream which sample it starts at (`x-stream-start`); `/api/clock` gives its time.
  - Each page measures its clock offset to the server (NTP-style, best of several round trips, refreshed every 10 s) and plays sample s at the agreed time, minus its own audio output latency. Blocks are butted together and steered with ≤0.5 % rate changes; big errors reschedule, and a block that arrives partly late plays its remaining part. A new stream starts from a 3–4 s backlog, so a phone joins in sync at once.
  - Tested in one machine: Chromium and Firefox pages within ~10–20 ms of each other. On phones over Wi-Fi expect ~10–30 ms.
  - **Sync slider** (next to Listen, per device, remembered): plays that device earlier (or later), for speakers that add their own delay. Bluetooth speakers are often 100–300 ms late: drag until the speakers sound as one. Double-click resets it.
  - Pads, echo and your voice aren't delayed: they play at once on each device, on top of the synced music.
- PipeWire remembers one output per app name, and both decks are "Chromium". Each deck therefore tags its audio with `PULSE_PROP tape_twist.deck=a|b`, and the engine moves any stream that lands on the wrong sink back where it belongs.
- `GET /api/engine-debug` shows each deck's raw player state.
- Pads are loaded from `./pads` (or `PADS_DIR`).

## Booth (effects)

The booth effects run **in each listening browser** (Web Audio, `app/utils/boothAudio.ts`), on top of the live stream, so they react at once on the device you press. Each page uses two audio contexts: the music and what changes it (echo, EQ, colour, duck) run with a ~60 ms output buffer, which survives the phone being locked (a 10–20 ms buffer crackled for a couple of seconds); pads and the Talkover voice are added on top from a separate lowest-latency context, so they stay instant (pads: ~30 ms). The server only keeps the shared booth state (`server/utils/booth.ts`) and relays every change and pad hit to all open pages over server-sent events (`/api/fx/events`), so every listening device plays the same thing within a few ms. A page that only controls (not listening) still drives the others.

The server mix (`server/utils/mixer.ts`) is just the music, as a Web Audio graph rendered natively by [node-web-audio-api](https://github.com/ircam-ismm/node-web-audio-api) (Rust): ffmpeg captures both deck sinks as raw audio, each deck goes through its bass shelf (bass swap), its platform level (Deezer boost) and its gain (crossfades are equal-power curves on the gain, sample-accurate), then a soft limiter, and a second ffmpeg encodes the MP3. The deck sinks themselves stay at 100 %. The graph is fed and read through ScriptProcessorNodes (43 ms callbacks on the main thread): this library's AudioWorklet busy-polls a whole CPU core. The whole mix uses ~2–3 % of a core and adds ~0.15 s of buffering.

- **Pads:** a 4×3 soundboard defined in `pads/pads.json` (emoji, label, mp3). Each listening page downloads and decodes them when you tap "Listen here", then plays them over the music, which ducks while one plays. Every pad toggles: tap it again while it plays to stop it. To swap a sound, drop an mp3 in `pads/`, edit the JSON and restart. Trim leading silence from new samples: it counts as latency.
- **Talkover (hold):** the music drops by the duck depth (default 10 dB) on every listening device and comes back on release. Your voice plays on your device at once (if it's listening), and on the others about 0.1 s later; your device needn't listen to talk over (then it only sends, from a mic-only graph, `app/utils/booth/talkSender.ts`): it goes phone → server → phones over a WebSocket (`/api/voice`, `app/utils/voiceLink.ts`), as 20 ms frames of 16 kHz PCM, outside the music stream and its sync delay. Each listener keeps a 60–200 ms jitter buffer per talker (`app/utils/voiceJitter.ts`). The phone re-sends "held" every 2 s, and the server releases it after 6 s of silence (in case a touch-release gets lost).
  - **Voice:** on the device you hold it on (if it's listening), your microphone plays straight into its output, funfair-tannoy style: cleaned up (low cut, presence, compressor), then a 130 ms slapback and a long bright reverb. *Voice volume* sets its level (remembered per device). Eight voices, picked per device in the Voice section's matrix, left of the big Talkover button: 📢 tannoy (that one), 🤖 robot (ring modulator + metallic comb), 🐿️ chipmunk (+7 semitones), 👹 monster (−6 semitones, more chest), 📣 megaphone (narrow honky band, driven into distortion), 🎹 vocoder (16 bands of your voice open the same bands of a low A-minor sawtooth chord), 🎶 auto-tune (YIN pitch detection, snapped to the nearest semitone in 15 ms, in an AudioWorklet: `app/utils/booth/autotune.ts`) and 🫧 underwater (muffled, slow deep chorus, bubbling echo). The pitch shifts are crossfaded sweeping delay lines. A voice is only built the first time it's picked, and only the chosen one is fed. Their levels are matched within ~3 dB. The voice also plays on the other listening devices (see Talkover above). The mic needs HTTPS (see above); it opens on the first press and stays open until you stop listening (or, on a device that isn't listening, until you tap "Listen here", which takes the talking over).
  - **Larsen (feedback):** the mic is opened with the browser's echo cancellation and noise suppression, which remove this device's own output and steady tones from it; the low cut removes the boomy range that rings first; the mic is only live while you hold. On top of that, a feedback detector watches the voice while you talk: a single tone towering over the spectrum at the same pitch for ~0.2 s gets a narrow notch (up to 6, kept for the evening; the browser console logs `larsen at … Hz`). It still helps a lot to stand behind or beside the speaker, not in front of it, and to talk close to the mic with the voice volume no higher than needed.
- **Pitch ▼ / ▲ (hold):** the music bends down or up while held (1.5 semitones per second, up to an octave), on every listening device, keeping its timing (two crossfaded sweeping delay taps, `app/utils/booth/pitch.ts`); let go and it glides back in 0.3 s, then plays dry again.
- **Brake (hold):** tape stop. The music slows to a standstill (pitch dropping with it) on every listening device; let go and it spins back up and is in sync again (a growing delay line, shrunk back to 0).
- **Rewind (hold):** the music spins backwards, faster and faster (up to 3× speed, through the last ~15 s), like a selector pulling the tune up; let go and it cuts straight back in live. Same trick as Brake: a delay that grows faster than time passes.
- **Build-up (hold):** over four bars (from the measured tempo) the bass is filtered away, a noise riser climbs and a snare roll speeds up from quarters to thirty-seconds; let go for the drop: everything back at once with a sub hit and a crash.
- **Slow-mo (hold):** the music eases down to 70 % speed (pitch with it) in 1.5 s; let go and it speeds back up in 1 s, then cuts back in live. A delay growing at 0.3 s per second (`app/utils/booth/moreHolds.ts`, like the next four).
- **Scratch (hold):** the record is pulled back ~0.2 s and pushed forward again, one stroke per beat, around the moment you pressed; let go and it cuts back in live.
- **Gater (hold):** the music is chopped on 1/16 notes in tempo (a softened square wave on its volume).
- **Flanger (hold):** a jet sweep (a 0.5–5.5 ms delay swept at 0.25 Hz, fed back), deeper over 4 s; it fades on release.
- **Dub siren (hold):** a square-wave siren whose pitch rises 450 → 1150 Hz once per beat ("whoop"), through its own echo (¾ beat, fed back), over the music and not ducked; let go and its echoes ring out.
- **Tape warble (hold):** a seasick wow on the music (a delay swept by 0.7 Hz and 0.23 Hz LFOs, up to ±3 % in pitch), deeper over 6 s; it straightens in 1 s on release. Idle, its delay is 0.
- **Echo throw (hold):** the next ¾ beat goes into the ping-pong echo, then the music drops out and the echoes repeat on their own (feedback 0.78); let go and the music comes back as they trail off (`BoothAudio.setEchoThrow`).
- **Stutter (hold, slide):** the last 1, ½, ¼ or ⅛ beat loops until you let go; slide along the strip to change the length while holding. The music runs on underneath, so it comes back live.
- **Tempo:** measured on the server from the mixed music (`server/utils/tempo.ts`: kick onsets, autocorrelation over 8 s), shared with every phone so the stutter loops and the snare roll are the same length everywhere. Shown next to Stutter; 124 BPM is used while there's no clear beat.
- **Light show (💡 Lights, hold):** while it's held, the screen of every listening device (the one holding it too) flashes a new colour on each kick, timed to when that device's speaker plays it, and stays awake. In the Android app it also lights a sleeping or locked phone up and shows over the lock screen (`NowPlayingPlugin.wake`: a screen wake lock and show-when-locked), and gives the screen back on release. A browser can't wake a phone: there, only a page on screen flashes.
- **XY pad:** drag a finger: left sweeps a low-pass, right a high-pass, up adds resonance and echo. Let go and it snaps back. Synced to every listening device like the hold buttons.
- **Record a pad (tick "Record a pad instead" under Talkover, then hold the button):** speak up to 4 s, name it, and it becomes a 🎤 pad for everyone. It gets the voice picked in the Voice section (same chain as Talkover, with slapback and reverb), rendered in the browser before upload. The server trims silence and saves it as MP3 in `data/pads/` (private, with `data/recorded-pads.json`). ✕ deletes it.
- **Colour:** old radio (band-pass, drive, crackle, hiss), phone (narrow band, mono), vinyl (crackle and warmth), cassette (tape wow and flutter: a delay line wobbling at 0.6 Hz and 7 Hz, soft top, hiss) or 8-bit (mono, sample-and-hold every 6 samples and 5-bit rounding in an AudioWorklet, `app/utils/booth/crusher.ts`), cross-faded in and out.
- **EQ:** 3-band EQ on the listening devices (low shelf 200 Hz, mid 1 kHz, high shelf 3.5 kHz). The bottom of each slider is a kill.
- **Deezer level:** Deezer tracks come out of its player about 12 dB quieter than the same songs on SoundCloud (measured on 6 songs available on both: SoundCloud −7 to −16 LUFS, Deezer −20 to −24, at full player and stream volume). The server mix evens them out with a gain stage per deck (`server/utils/mixer.ts`): **−9 dB** on SoundCloud and **+3 dB** on Deezer by default. Boosting Deezer the full +11.5 dB alone saturated the mix; splitting the difference leaves headroom. Both are adjustable under *Transitions & safety*.
- **Bass swap:** during crossfades of 2 s or more, the incoming track starts without bass, and at the midpoint the basses trade places.
- **Safety:**
  - Auto-pause after N hours of continuous playback (default 6).
  - Auto-pause when nobody has listened for N minutes (default 15).
  - The hidden browsers close after 15 min without playback, which frees RAM and your Deezer session.

## Ask Claude

One line at the top of each playlist: a request ("calm bass music for ambience. go around Kebuffeule (Iorie remix)"), how many songs, ✨. The songs are placed in that playlist. Claude runs through the Claude Code CLI installed on the server machine (`claude -p`, its own login; no API key), one request at a time, Opus 5.5 at low effort (`CLAUDE_MIX_MODEL`, `CLAUDE_MIX_EFFORT`, `CLAUDE_BIN` to change). Claude first writes searches; the server gathers real SoundCloud/Deezer results plus SoundCloud's "related tracks" of the reference songs, then Claude lays out the upcoming part of the playlist: the upcoming songs are numbered `P0…`, the candidates `N0…`, and it answers with one list mixing both. SoundCloud Go+ tracks (policy `SNIP`: a 30 s preview without a subscription) are left out of every search and related list, so the Deezer version comes in instead; in your SoundCloud likes they show a red "30 s" badge. So it can only name real songs; it may slot the new ones between the upcoming ones and move those when asked ("put the sea shanties together"). The server checks the answer: unknown or repeated numbers are dropped, a forgotten upcoming song goes back after the one it followed, and the songs already played (up to the one playing) never move. The page applies the layout only if the playlist didn't change while Claude was thinking; otherwise the new songs are appended. A request that only asks to rearrange skips the catalog searches. Claude's note on what it did shows under the line.

The evening list has a revision number, so two open players never silently overwrite each other.

### Reaching it from outside (Tailscale Funnel)

Optional (`--funnel`, see the README). `tailscale funnel --bg https+insecure://localhost:3000` publishes the app at `https://<machine>.<tailnet>.ts.net`. Anyone with that link reaches the lock screen; the API needs the host PIN. Still, turn it off after the party (`tailscale funnel reset`). A visitor who opens the ts.net link from the home Wi-Fi is sent to the LAN address (`https://192.168.1.x:3000`) so the stream doesn't go out to the internet and back: Funnel passes the visitor's address, and the server compares it with the home's public IP from `tailscale netcheck`. Set `LAN_REDIRECT=0` to turn that off. The QR button in the player header shows the player's link as a QR code: the Funnel one while `tailscale funnel status` says it's on (`funnelHost()` in `server/utils/network.ts`), else the LAN one. The same addresses are printed at start-up (`server/plugins/network.ts`).

## Docker

```sh
./scripts/serve.sh                # rebuild + restart the container (add --funnel for the Funnel)
docker compose up -d --build      # the same, by hand: https://<this-machine-ip>:3000, data in ./data
docker compose logs -f            # its output
```

One container holds everything the desktop provides otherwise (`Dockerfile`, `docker/entrypoint.sh`): a PulseAudio daemon for the decks' virtual sinks (nothing plays on the host), Xvfb as the login browser's invisible screen (you see it through **Connect**, above), ffmpeg, Playwright's Chromium, and a self-signed certificate created in `data/tls` on first start. It uses the host network, so the QR code gets the LAN address and phones reach port 3000, and a 1 GB `/dev/shm` for Chromium.

- **Tailscale:** the Funnel stays on the host; there's no Tailscale in the image. `./scripts/serve.sh --funnel` reads the Funnel address and the home's public IP on the host and passes them to the container (`FUNNEL_HOST`, `HOME_PUBLIC_IP`, through `docker-compose.funnel.yml`). Without them the QR code shows the LAN address and the LAN redirect is off. The LAN redirect skips Android WebViews (the app, in-app browsers): they refuse the LAN's self-signed certificate. The app's offline page (`native/www/index.html`, the Funnel address filled in by `Dockerfile.apk`) asks the server again every 5 s and opens it once it answers. (Mounting the host's `tailscaled.sock` instead is blocked by SELinux on Fedora.)
- **Ask Claude:** a long-lived token from `claude setup-token`, saved in `data/claude-token` (read on each request; `CLAUDE_CODE_OAUTH_TOKEN` overrides it), or mount your Claude Code login (`~/.claude`, `~/.claude.json`; commented out in `docker-compose.yml`). Build with `--build-arg WITH_CLAUDE=0` to leave the CLI out.
- **Already logged in on a desktop?** Copy `data/` over: credentials and profiles work as they are.
- The container runs as uid 1000, normally the owner of `./data`.

## Project layout

```
shared/types/        types used by both sides (songs and playlists, booth, engine)
app/
  pages/             index.vue: it only puts the components together
  components/        PlatformBadge, track/ (TrackArt, TrackRow), player/ (header, search, QR link,
                     player bar), evening/ (playlists, Ask Claude, the list), booth/ (pads, holds, XY, EQ…)
  composables/       state and logic, one concern each: usePlatforms, useEvening, useEngine,
                     useListening, useBooth, useVoice (shared by the whole page),
                     useFavoriteSearch, usePadRecorder, useConfirmTap (per component)
  utils/             framework-free code: liveAudio / livePlayerCore / pcmBlocks /
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
- `npm run test:e2e`: four phones messing with the booth for a minute. It builds into `.output-e2e`, starts the server on port 3190 with a temporary data folder and its own PipeWire sinks (`tape_twist_e2e_*`, removed afterwards), plays a 124 BPM test beat into deck A, and opens four browsers that listen: two Chromes, Firefox, and Chrome behind a 4G-like link (30–80 ms, plus a hiccup of up to 220 ms every few seconds). Each page's audio output is tapped. They hammer pads, holds, stutter, XY, colour, EQ, lights and Listen, then it checks that no hold stays stuck, every phone still plays its music without dropouts, every pad (also a newly added one) plays on every phone, and the light show shows on every listening phone while Lights is held. Safe next to a running server. `E2E_CHAOS_SEC=20` shortens the chaos; `E2E_SEED` replays one (printed at the start).

## Notes

- Deezer may substitute a newer ID for an older favorite (same song). The deck accepts the match by ID or by title.
- Playback goes through the server because Deezer's embeddable widget only ever plays 30-second previews, even when logged in.
- `data/` holds live session tokens. It is git-ignored; keep it private.
- Tokens never reach any browser.
