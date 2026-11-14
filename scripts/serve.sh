#!/usr/bin/env bash
# Build, then serve the app over https on :3000 on the local network (self-signed cert).
#   npm run serve                    build and run on this machine
#   npm run serve -- --no-build      run the last build
#   npm run serve -- --docker        (re)build the image and (re)start the container instead
#   ... --funnel                     also publish it through the Tailscale Funnel (optional)
set -euo pipefail
cd "$(dirname "$0")/.."

docker=0 build=1 funnel=0
for a in "$@"; do
  case $a in
    --docker) docker=1 ;;
    --no-build) build=0 ;;
    --funnel) funnel=1 ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done

# The Funnel is kept by tailscaled itself (--bg), but one left from the last run sometimes
# fails once the server is back, so each start turns it off and on again.
# sudo is only needed while this user isn't the Tailscale operator
# (`sudo tailscale set --operator=$USER` once removes it).
ts() { tailscale "$@" 2>/dev/null || sudo tailscale "$@"; }
start_funnel() {
  command -v tailscale >/dev/null || { echo "--funnel needs Tailscale on this machine" >&2; exit 1; }
  ts funnel --https=443 off >/dev/null || true # nothing to turn off on the first run
  ts funnel --bg --yes https+insecure://localhost:3000 >/dev/null
}
port_used() { ss -ltnH 'sport = :3000' | grep -q .; }

if ((docker)); then
  # With the Funnel, the container also gets the host's Tailscale socket (QR code, LAN redirect).
  compose=(docker compose -f docker-compose.yml)
  ((funnel)) && compose+=(-f docker-compose.funnel.yml)
  # The container replaces itself; anything else on :3000 would clash with it.
  if port_used && ! docker compose ps -q --status running | grep -q .; then
    echo "Port 3000 is in use by something other than the container:" >&2
    ss -ltnpH 'sport = :3000' >&2
    exit 1
  fi
  ((funnel)) && start_funnel
  since=$(date +%s)
  if ((build)); then "${compose[@]}" up -d --build; else "${compose[@]}" up -d --force-recreate; fi
  # Show the addresses the server prints once it's up (its last line starts with "Guests").
  for _ in $(seq 90); do
    out=$(docker compose logs --no-log-prefix --since "$since" 2>/dev/null || true)
    if grep -q 'Guests ' <<<"$out"; then sed -n '/Tape Twist is up/,/Guests /p' <<<"$out"; break; fi
    sleep 1
  done
  echo "Logs: docker compose logs -f"
  exit
fi

if port_used; then
  echo "Port 3000 is already in use (another 'npm run serve', 'npm run dev:https' or the container?):" >&2
  ss -ltnpH 'sport = :3000' >&2
  exit 1
fi

[[ -f data/tls/cert.pem ]] || npm run cert
((build)) && npm run build
((funnel)) && start_funnel
exec npm run start:https
