#!/usr/bin/env bash
# Build the image and (re)start Tape Twist in Docker, on https://<this-machine-ip>:3000.
# Needs only bash and Docker (Compose v2).
#   ./scripts/serve.sh               build and (re)start
#   ./scripts/serve.sh --no-build    restart without rebuilding
#   ./scripts/serve.sh --funnel      also publish it through the Tailscale Funnel (optional)
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
  # Tailscale stays on the host; the container gets its socket (QR code, LAN redirect).
  command -v tailscale >/dev/null || { echo "--funnel needs Tailscale on this machine" >&2; exit 1; }
  compose+=(-f docker-compose.funnel.yml)
  # tailscaled keeps the Funnel (--bg), but one left from the last run sometimes fails once the
  # server is back, so each start turns it off and on again. sudo is only needed while this user
  # isn't the Tailscale operator (`sudo tailscale set --operator=$USER` once removes it).
  ts() { tailscale "$@" 2>/dev/null || sudo tailscale "$@"; }
  ts funnel --https=443 off >/dev/null || true # nothing to turn off on the first run
  ts funnel --bg --yes https+insecure://localhost:3000 >/dev/null
fi

# The container replaces itself; anything else on :3000 (a dev server) would clash with it.
if ss -ltnH 'sport = :3000' 2>/dev/null | grep -q . && ! docker compose ps -q --status running | grep -q .; then
  echo "Port 3000 is in use by something other than the container:" >&2
  ss -ltnpH 'sport = :3000' >&2
  exit 1
fi

since=$(date +%s)
if ((build)); then "${compose[@]}" up -d --build; else "${compose[@]}" up -d --force-recreate; fi

# Show the addresses the server prints once it's up (a block ending with an empty line).
for _ in $(seq 90); do
  out=$(docker compose logs --no-log-prefix --since "$since" 2>/dev/null || true)
  if grep -q 'Tape Twist is up' <<<"$out"; then sed -n '/Tape Twist is up/,/^$/p' <<<"$out"; break; fi
  sleep 1
done
echo "Logs: docker compose logs -f    Stop: docker compose down"
