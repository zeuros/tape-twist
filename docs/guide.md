# Tape Twist guide

Everything beyond the quick start in the [README](../README.md). How each part works is in [internals.md](internals.md).

## First evening

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
