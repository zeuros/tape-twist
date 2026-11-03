# Evening Mix

Browse your SoundCloud and Deezer favorites in one searchable list, arrange an evening playlist with start times and mood tags, and play it with crossfades. The server does the playing; any phone or laptop on the LAN is the remote and can listen to the live stream.

Requires Linux with PipeWire or PulseAudio (`pactl`) and `ffmpeg` with libmp3lame.

- **Guests:** `https://<this-machine-ip>:3000/`. They can search your favorites and the whole SoundCloud and Deezer catalogs, request tracks and vote.
- **Player:** `https://<this-machine-ip>:3000/player`. Open to anyone on the LAN, no PIN (it's meant for friends).

```sh
# once
npm install
npx playwright install chromium   # the hidden player decks
npm run cert                      # self-signed certificate in data/tls/

npm run dev:https                 # https://<this-machine-ip>:3000, reachable on the LAN
# or
npm run build && npm run start:https
```

The app is served over HTTPS because browsers only give the microphone (Talkover) to `https://` pages. Each phone shows a certificate warning once: accept it.

## How credentials work

- **Connect** opens a visible Chromium window **on the machine running the server** (it uses a saved profile in `data/profiles/<platform>`). You log in yourself. The app waits for the session cookie (`oauth_token` for SoundCloud, `arl` for Deezer), records the headers the site sends to its own API (plus SoundCloud's `client_id`), saves them to `data/credentials-<platform>.json`, and closes the window.
- API calls replay those captured headers, cookies and user agent:
  - SoundCloud: `api-v2.soundcloud.com` (`/me`, `track_likes`, `playlist_likes`)
  - Deezer: `www.deezer.com/ajax/gw-light.php` (`deezer.getUserData`, `song.getFavoriteIds`, `song.getListData`, and `deezer.pageSearch` for catalog search)
  - SoundCloud catalog search: `/search/tracks` and `/search/playlists_without_albums`. The player's **Search** panel shows matching favorites first, then catalog results from both platforms (following the source and kind filters).
- When a call gets a 401 or 403, or the session token is invalid, the app first reopens the saved profile headlessly to refresh the credentials. Only if that fails does the UI ask you to **Connect** again.

## Playback

```
 Deezer / SoundCloud                 virtual sinks             ffmpeg            phone
 deck A (hidden Chromium) ──audio──▶ evening_mix_a ─┐
                                                    ├─ Node mix → MP3 ──▶ /api/stream ──▶ phone: + pads, colour, echo, EQ (Web Audio)
 deck B (hidden Chromium) ──audio──▶ evening_mix_b ─┘
```

- Each **deck** is a headless Chromium whose sound goes to its own virtual sink (`evening_mix_a` / `_b`), so nothing plays through the PC's speakers.
  - Deezer plays in a deezer.com page through its own player (`dzPlayer`), logged in with the captured cookies, so you get full tracks.
  - SoundCloud plays through the official widget API.
- **Crossfades:** the next item is preloaded on the idle deck. When the current item is `crossfade` seconds from its end, the two sinks are ramped with equal-power curves. Deezer→Deezer can't overlap (one stream per account), so it fades out, then in, on the same deck.
- **Listen here** plays the live mix on that device (`app/utils/liveAudio.ts`). Lock-screen and headset buttons control the server.
  - Chrome: `/api/stream` (MP3), fed to the `<audio>` element through Media Source Extensions.
  - Firefox and iPhones (no MP3 in Media Source Extensions): `/api/stream?format=pcm`, the same audio as raw 16-bit PCM (~1.5 Mbit/s per device, fine on a LAN). The page cuts it into 0.1 s blocks and schedules each one with Web Audio at its exact time. The final mix then plays out through a hidden `<audio>` element (a MediaStream), because Firefox on Android suspends pure Web Audio when the screen goes off but keeps a playing media element alive.
- **Sync:** every listening device plays the same instant, 1.2 s behind the server, so several phones on several speakers sound as one.
  - The MP3 is constant bitrate (every 576-byte frame is 1152 samples), so a byte offset is a sample position. The server records when each sample was rendered on its clock and tells each new stream which sample it starts at (`x-stream-start`); `/api/clock` gives its time.
  - Each page measures its clock offset to the server (NTP-style, best of several round trips, refreshed every 10 s) and plays sample s at the agreed time, minus its own audio output latency. MP3: small errors are steered out with the element's playback rate (≤2 %), big ones (a stall) with a jump. PCM: blocks are butted together and steered with ≤0.5 % rate changes, big errors reschedule. A new stream starts from a 3–4 s backlog, so a phone joins in sync at once.
  - Tested in one machine: Chromium pages (MP3 and PCM) within ~10–20 ms of each other; Firefox (PCM) syncs too. On phones over Wi-Fi expect ~10–30 ms.
  - **Sync slider** (next to Listen, per device, remembered): plays that device earlier (or later), for speakers that add their own delay. Bluetooth speakers are often 100–300 ms late: drag until the speakers sound as one. Double-click resets it.
  - Pads, echo and your voice aren't delayed: they play at once on each device, on top of the synced music.
- PipeWire remembers one output per app name, and both decks are "Chromium". Each deck therefore tags its audio with `PULSE_PROP evening.deck=a|b`, and the engine moves any stream that lands on the wrong sink back where it belongs.
- `GET /api/engine-debug` shows each deck's raw player state.
- Run `npm run start:https` from the project folder: pads are loaded from `./pads` (or `PADS_DIR`).

## Booth (effects)

The booth effects run **in each listening browser** (Web Audio, `app/utils/boothAudio.ts`), on top of the live stream, so they react at once on the device you press. Each page uses two audio contexts: the music and what changes it (echo, EQ, colour, duck) run with a ~60 ms output buffer, which survives the phone being locked (a 10–20 ms buffer crackled for a couple of seconds); pads and the Talkover voice are added on top from a separate lowest-latency context, so they stay instant (pads: ~30 ms). The server only keeps the shared booth state (`server/utils/booth.ts`) and relays every change and pad hit to all open pages over server-sent events (`/api/fx/events`), so every listening device plays the same thing within a few ms. A page that only controls (not listening) still drives the others.

The server mix (`server/utils/mixer.ts`) is just the music, as a Web Audio graph rendered natively by [node-web-audio-api](https://github.com/ircam-ismm/node-web-audio-api) (Rust): ffmpeg captures both deck sinks as raw audio, each deck goes through its bass shelf (bass swap) and its gain (crossfades are equal-power curves on the gain, sample-accurate), then a soft limiter, and a second ffmpeg encodes the MP3. The deck sinks themselves stay at 100 %. The graph is fed and read through ScriptProcessorNodes (43 ms callbacks on the main thread): this library's AudioWorklet busy-polls a whole CPU core. The whole mix uses ~2–3 % of a core and adds ~0.15 s of buffering.

- **Pads:** a 4×3 soundboard defined in `pads/pads.json` (emoji, label, mp3). Each listening page downloads and decodes them when you tap "Listen here", then plays them over the music, which ducks while one plays. Every pad toggles: tap it again while it plays to stop it. To swap a sound, drop an mp3 in `pads/`, edit the JSON and restart. Trim leading silence from new samples: it counts as latency.
- **Talkover (hold):** the music drops by the duck depth (default 10 dB) on every listening device and comes back on release. The phone re-sends "held" every 2 s, and the server releases it after 6 s of silence (in case a touch-release gets lost).
  - **Voice:** on the device you hold it on (if it's listening), your microphone plays straight into its output, funfair-tannoy style: cleaned up (low cut, presence, compressor), then a 130 ms slapback and a long bright reverb. *Voice volume* sets its level (remembered per device). Four voices, picked per device (under the pads; recorded pads use it too): 📢 tannoy (that one), 🤖 robot (ring modulator + metallic comb), 🐿️ chipmunk (+7 semitones) and 👹 monster (−6 semitones, more chest); the pitch shifts are two crossfaded sweeping delay lines (~0.1 s). It only plays on that device, not on the other listening ones. The mic needs HTTPS (see above); it opens on the first press and stays open until you stop listening.
  - **Larsen (feedback):** the mic is opened with the browser's echo cancellation and noise suppression, which remove this device's own output and steady tones from it; the low cut removes the boomy range that rings first; the mic is only live while you hold. On top of that, a feedback detector watches the voice while you talk: a single tone towering over the spectrum at the same pitch for ~0.2 s gets a narrow notch (up to 6, kept for the evening; the browser console logs `larsen at … Hz`). It still helps a lot to stand behind or beside the speaker, not in front of it, and to talk close to the mic with the voice volume no higher than needed.
- **Echo out (tap):** throws a ping-pong echo (375 ms, darker repeats) into the music, the server cuts the track and brings in the next one; each page keeps its echo open until the cut reaches it (it knows how far behind live it is).
- **Brake (hold):** tape stop. The music slows to a standstill (pitch dropping with it) on every listening device; let go and it spins back up and is in sync again (a growing delay line, shrunk back to 0).
- **XY pad:** drag a finger: left sweeps a low-pass, right a high-pass, up adds resonance and echo. Let go and it snaps back. Synced to every listening device like the hold buttons.
- **Record a pad (hold the 🔴 tile):** speak up to 4 s, name it, and it becomes a 🎤 pad for everyone. It gets the voice picked under the pads (same chain as Talkover, with slapback and reverb), rendered in the browser before upload. The server trims silence and saves it as MP3 in `data/pads/` (private, with `data/recorded-pads.json`). ✕ deletes it.
- **Colour:** old radio (band-pass, drive, crackle, hiss), phone (narrow band, mono) or vinyl (crackle and warmth), cross-faded in and out.
- **EQ:** 3-band EQ on the listening devices (low shelf 200 Hz, mid 1 kHz, high shelf 3.5 kHz). The bottom of each slider is a kill.
- **Bass swap:** during crossfades of 2 s or more, the incoming track starts without bass, and at the midpoint the basses trade places.
- **Safety:**
  - Auto-pause after N hours of continuous playback (default 6).
  - Auto-pause when nobody has listened for N minutes (default 15).
  - The hidden browsers close after 15 min without playback, which frees RAM and your Deezer session.

## Ask Claude

One line at the top of each playlist: a request ("calm bass music for ambience. go around Kebuffeule (Iorie remix)"), how many songs, ✨. The songs are appended to that playlist. Claude runs through the Claude Code CLI installed on the server machine (`claude -p`, its own login; no API key), one request at a time, Opus 5.5 at low effort (`CLAUDE_MIX_MODEL`, `CLAUDE_MIX_EFFORT`, `CLAUDE_BIN` to change). Claude first writes searches; the server gathers real SoundCloud/Deezer results plus SoundCloud's "related tracks" of the reference songs, then Claude picks and orders songs from that list. Its note on the direction it took shows under the line.

## Guest requests

Guests get a cookie ID, with no account needed. Asking for a track that's already requested counts as a vote. Each guest can have at most 5 pending requests. Approving a request inserts it right after the current track, behind earlier approved requests. The evening list has a revision number, so two open players (or a player plus approvals) never silently overwrite each other.

## Notes

- Deezer may substitute a newer ID for an older favorite (same song). The deck accepts the match by ID or by title.
- Playback goes through the server because Deezer's embeddable widget only ever plays 30-second previews, even when logged in.
- `data/` holds live session tokens. It is git-ignored; keep it private.
- Everything is open to anyone on the LAN, player included. Don't expose the port to the internet. Tokens never reach any browser.
