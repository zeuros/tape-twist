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

All you need is **Docker**: the image brings its own sound server, ffmpeg and Chromium.

```sh
git clone https://github.com/zeuros/tape-twist.git && cd tape-twist
./scripts/serve.sh [--funnel]     # build the image, (re)start the container, print the links
                                  # --funnel: also public through Tailscale (see below)
```

That's it: open the printed link from any phone on the same Wi-Fi. The app stays on your local network. `./scripts/serve.sh --no-build` restarts it, `docker compose logs -f` follows it, `docker compose down` stops it. Your data (logins, playlists, PIN) stays in `./data`.

> 💡 Ask Claude: uncomment the `~/.claude` mounts in `docker-compose.yml`.

### First evening

1. **Open the player** at `https://<this-machine-ip>:3000` and accept the certificate warning (once per phone; HTTPS is what lets the mic work).
2. **Enter the PIN.** It's `1234` unless you put your own in `data/host-pin` (or `HOST_PIN`); restart after changing it.
3. **Connect** SoundCloud and Deezer. The login page shows right in the player, even on a phone: log in as usual, popups and 2FA included. Your session is saved in `data/` and refreshed by itself.
4. **Build a playlist**, press play, and hit **Listen here** on every phone near a speaker (the QR button in the header opens the player on another phone).

## 🌍 Optional: open it to the internet (Tailscale Funnel)

Off by default. For phones on 4G or friends elsewhere, [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) gives the app a public address with a real certificate, `https://<machine>.<tailnet>.ts.net`. Tailscale runs on the host, not in the container.

1. Install Tailscale on this machine, log in, and allow Funnel for it in the admin console.
2. Run `sudo tailscale set --operator=$USER` once, so the script doesn't need sudo.
3. Start with `./scripts/serve.sh --funnel`.

Each start turns the Funnel off and on again (an old one sometimes breaks); the start-up message and the QR code then show its address.

- Everything needs the PIN, and a wrong PIN blocks every try for 10 s.
- Visitors on your home Wi-Fi are sent to the LAN address, so the stream doesn't go out and back (`LAN_REDIRECT=0` turns that off).
- The Funnel stays on after the server stops: `tailscale funnel reset` after the party.

## 📲 Android app

A small shell that opens the player full screen, with lock-screen controls. It opens the Funnel address (the phone's WebView refuses the LAN's self-signed certificate), so `./scripts/serve.sh --funnel` builds it, in Docker, into `data/tape-twist.apk`; the server offers it at `/tape-twist.apk`. The first build takes a few minutes (it fetches the Android SDK); after that it's cached and only rebuilds when the native shell, `capacitor.config` or the address changes. App updates arrive by themselves. `./scripts/apk.sh [https://<host>]` builds it on its own.

## 🛠️ Commands

| Command | What it does |
| --- | --- |
| `./scripts/serve.sh` | Build and (re)start the container (`--no-build`, `--funnel`: also the Android app) |
| `./scripts/apk.sh` | Build the Android app on its own (`npm run android:apk`) |
| `docker compose logs -f` / `down` | Follow it / stop it |
| `npm run dev:https` | Hot-reload dev server (needs Node, PipeWire or PulseAudio, ffmpeg) |
| `npm run typecheck` | Type-check the whole project |
| `npm test` | Unit tests: sync, MP3 blocks, tempo |
| `npm run test:e2e` | Four browsers hammering the booth for a minute |

## 🧭 How it works

Two hidden Chromium **decks** play Deezer and SoundCloud into virtual sound cards. The server mixes them and streams one MP3, and every phone plays sample *s* at the same server time, 0.55 s behind live.

```
deck A (Chromium) ──▶ tape_twist_a ──┐
                                     ├─▶ mix ─▶ MP3 ─▶ /api/stream ─▶ 📱📱📱 + booth effects
deck B (Chromium) ──▶ tape_twist_b ──┘
```

The full story (credentials, sync, every booth effect, project layout, tests) is in **[docs/internals.md](docs/internals.md)**.

## 🔒 Privacy

`data/` holds live session tokens, browser profiles and your PIN. It is git-ignored: keep it private. Tokens never reach any browser.
