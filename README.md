<p align="center">
  <img src="public/favicon.svg" width="120" alt="Tape Twist logo: two cassette reels and a beak">
</p>

<h1 align="center">Tape Twist</h1>

<p align="center">
  <b>Your SoundCloud and Deezer favorites, mixed live for the whole party.</b><br>
  Crossfaded evening playlists · every phone a synced speaker · a DJ booth in your pocket
</p>

<p align="center">
  <img alt="Nuxt 4" src="https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt.js&logoColor=white">
  <img alt="Linux" src="https://img.shields.io/badge/runs%20on-Linux-ff7385?logo=linux&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white">
  <img alt="Android" src="https://img.shields.io/badge/Android-APK-3DDC84?logo=android&logoColor=white">
</p>

---

## ✨ What it does

- 🎧 **One library.** Search your SoundCloud and Deezer likes together, plus both full catalogs.
- 📼 **Evening playlists.** Give songs start times; the server plays them with equal-power crossfades and bass swaps.
- 📱 **Every phone is a speaker.** Tap *Listen here* and all devices play the same instant (within ~10–30 ms on Wi-Fi), with a slider to cancel Bluetooth delay.
- 🎛️ **A booth for everyone listening.** Pads, talkover with funny voices, tape brake, rewind, build-up, stutter, XY filter, EQ, a light show on the kicks, and pads you record yourself.
- 🤖 **Ask Claude.** "Calm bass music for ambience, around this track", ✨, and real songs land in the playlist, placed where they fit (it can also regroup the upcoming ones on request).

## 🚀 Setup

**You need** either Docker (nothing else: the image brings its own sound server, ffmpeg and Chromium), or Linux with PipeWire or PulseAudio (`pactl`), `ffmpeg` with libmp3lame, and Node.js.

### Option A: on this machine

```sh
npm install
npx playwright install chromium   # the hidden player decks and the login browser
npm run serve                     # build and run on https://<this-machine-ip>:3000
```

### Option B: in Docker

```sh
npm run serve -- --docker         # build the image, (re)start the container
docker compose logs -f            # follow the server output
```

Both print where to open the app once it's up. It stays on your local network: phones on the same Wi-Fi join, nobody else.

One container holds everything: a PulseAudio daemon for the decks, a virtual screen for the login browser, ffmpeg, Chromium, and a certificate made on first start. Your data stays in `./data`.

> 💡 Ask Claude in Docker: uncomment the `~/.claude` mounts in `docker-compose.yml`. Logged in on the desktop already? Copy `data/` over.

### First evening

1. **Open the player** at `https://<this-machine-ip>:3000` and accept the certificate warning (once per phone; HTTPS is what lets the mic work).
2. **Enter the PIN.** It's `1234` unless you put your own in `data/host-pin` (or `HOST_PIN`); restart after changing it.
3. **Connect** SoundCloud and Deezer. The login page shows right in the player, even on a phone: log in as usual, popups and 2FA included. Your session is saved in `data/` and refreshed by itself.
4. **Build a playlist**, press play, and hit **Listen here** on every phone near a speaker (the QR button in the header opens the player on another phone).

## 🌍 Optional: open it to the internet (Tailscale Funnel)

Off by default. For phones on 4G or friends elsewhere, [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) gives the app a public address with a real certificate, `https://<machine>.<tailnet>.ts.net`. Tailscale stays on the host, Docker or not.

1. Install Tailscale on this machine, log in, and allow Funnel for it in the admin console.
2. Run `sudo tailscale set --operator=$USER` once, so the script doesn't need sudo.
3. Add `--funnel`: `npm run serve -- --funnel`, or `npm run serve -- --docker --funnel`.

Each start turns the Funnel off and on again (an old one sometimes breaks); the start-up message and the QR code then show its address.

- Everything needs the PIN, and a wrong PIN blocks every try for 10 s.
- Visitors on your home Wi-Fi are sent to the LAN address, so the stream doesn't go out and back (`LAN_REDIRECT=0` turns that off).
- The Funnel stays on after the server stops: `tailscale funnel reset` after the party.

## 📲 Android app

`npm run android:apk` builds a small shell (it needs JDK 21) that opens the player full screen, with lock-screen controls. Rebuild it only when the native shell, `capacitor.config` or the server URL changes; app updates arrive by themselves. The server offers the APK at `/tape-twist.apk`.

## 🛠️ Commands

| Command | What it does |
| --- | --- |
| `npm run serve` | Build and serve over HTTPS on :3000 (`-- --no-build` skips the build) |
| `npm run serve -- --docker` | Same in Docker |
| `... --funnel` | Also publish it through the Tailscale Funnel |
| `npm run dev:https` | Hot-reload dev server at the same address |
| `npm run typecheck` | Type-check the whole project |
| `npm test` | Unit tests: sync, MP3 blocks, tempo |
| `npm run test:e2e` | Four browsers hammering the booth for a minute |

## 🧭 How it works

Two hidden Chromium **decks** play Deezer and SoundCloud into virtual sound cards. The server mixes them and streams one MP3, and every phone plays sample *s* at the same server time, 0.45 s behind live.

```
deck A (Chromium) ──▶ tape_twist_a ──┐
                                     ├─▶ mix ─▶ MP3 ─▶ /api/stream ─▶ 📱📱📱 + booth effects
deck B (Chromium) ──▶ tape_twist_b ──┘
```

The full story (credentials, sync, every booth effect, project layout, tests) is in **[docs/internals.md](docs/internals.md)**.

## 🔒 Privacy

`data/` holds live session tokens, browser profiles and your PIN. It is git-ignored: keep it private. Tokens never reach any browser.
