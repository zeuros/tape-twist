#!/usr/bin/env bash
# Build the image and (re)start Tape Twist in Docker, on https://<this-machine-ip>:3000.
# Needs only bash and Docker (Compose v2).
#   ./scripts/serve.sh               build and (re)start
#   ./scripts/serve.sh --no-build    restart without rebuilding
#   ./scripts/serve.sh --funnel      also publish it through the Tailscale Funnel (optional),
#                                    and (re)build the Android app for it (scripts/apk.sh)
# (`npm run serve -- <options>` runs the same.)
set -euo pipefail
cd "$(dirname "$0")/.."

build=1 funnel=0
for a in "$@"; do
  case $a in
    --no-build) build=0 ;;
    --funnel) funnel=1 ;;
    --docker) ;; # the only mode now; kept so old commands still work
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done

compose=(docker compose -f docker-compose.yml)

if ((funnel)); then
  # Tailscale stays on the host; the container is told its Funnel address and the home's
  # public IP (start-up links, QR code, LAN redirect), see docker-compose.funnel.yml.
  command -v tailscale >/dev/null || { echo "--funnel needs Tailscale on this machine" >&2; exit 1; }
  compose+=(-f docker-compose.funnel.yml)
  # tailscaled keeps the Funnel (--bg), but one left from the last run sometimes fails once the
  # server is back, so each start turns it off and on again. sudo is only needed while this user
  # isn't the Tailscale operator (`sudo tailscale set --operator=$USER` once removes it).
  ts() { tailscale "$@" 2>/dev/null || sudo tailscale "$@"; }
  ts funnel --https=443 off >/dev/null || true # nothing to turn off on the first run
  ts funnel --bg --yes https+insecure://localhost:3000 >/dev/null
  FUNNEL_HOST=$(tailscale funnel status 2>/dev/null | sed -n 's#^https://\([^ /:]*\).*#\1#p' | head -1)
  HOME_PUBLIC_IP=$(tailscale netcheck --format=json 2>/dev/null | grep -o '"GlobalV4": *"[0-9.]*' | grep -o '[0-9.]*$' || true)
  export FUNNEL_HOST HOME_PUBLIC_IP
fi

# The container replaces itself; anything else on :3000 (a dev server) would clash with it.
if ss -ltnH 'sport = :3000' 2>/dev/null | grep -q . && ! docker compose ps -q --status running | grep -q .; then
  echo "Port 3000 is in use by something other than the container:" >&2
  ss -ltnpH 'sport = :3000' >&2
  exit 1
fi

if ((build)); then "${compose[@]}" up -d --build; else "${compose[@]}" up -d --force-recreate; fi

# Show the addresses the server prints once it's up (a block ending with an empty line), from
# the current run of the container: it's left running as is when nothing changed.
for _ in $(seq 90); do
  started=$(docker inspect -f '{{.State.StartedAt}}' "$(docker compose ps -q)" 2>/dev/null || true)
  out=$(docker compose logs --no-log-prefix --since "${started:-1m}" 2>/dev/null || true)
  if grep -q 'Tape Twist is up' <<<"$out"; then sed -n '/Tape Twist is up/,/^$/p' <<<"$out"; break; fi
  sleep 1
done
grep -q 'Tape Twist is up' <<<"$out" || echo "The server didn't say it's up after 90 s: see docker compose logs" >&2

# The Android app opens the Funnel address: rebuilt when that or its sources changed (cached).
if ((funnel)) && [ -n "${FUNNEL_HOST:-}" ]; then
  ./scripts/apk.sh "https://$FUNNEL_HOST" || echo "⚠ The Android app didn't build (the server runs anyway)" >&2
fi
echo "Logs: docker compose logs -f    Stop: docker compose down"
