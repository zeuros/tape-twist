#!/usr/bin/env bash
# Build, then serve the app over https on :3000 (LAN, self-signed cert) with the Tailscale
# Funnel in front of it (public https://<machine>.<tailnet>.ts.net, real cert).
#   npm run serve                    build and run on this machine
#   npm run serve -- --no-build      run the last build
#   npm run serve -- --docker        (re)build the image and (re)start the container
set -euo pipefail
cd "$(dirname "$0")/.."

docker=0 build=1
for a in "$@"; do
  case $a in
    --docker) docker=1 ;;
    --no-build) build=0 ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done

# The funnel is kept by tailscaled itself (--bg), but a funnel left from the last run sometimes
# fails once the server is back, so each start turns it off and on again.
# sudo is only needed while this user isn't the Tailscale operator
# (`sudo tailscale set --operator=$USER` once removes it).
ts() { tailscale "$@" 2>/dev/null || sudo tailscale "$@"; }
funnel() {
  ts funnel --https=443 off >/dev/null || true # nothing to turn off on the first run
  ts funnel --bg --yes https+insecure://localhost:3000 >/dev/null
  tailscale funnel status | grep -E '^https://' || true
}
port_used() { ss -ltnH 'sport = :3000' | grep -q .; }

if ((docker)); then
  # The container replaces itself; anything else on :3000 would clash with it.
  if port_used && ! docker compose ps -q --status running | grep -q .; then
    echo "Port 3000 is in use by something other than the container:" >&2
    ss -ltnpH 'sport = :3000' >&2
    exit 1
  fi
  if ((build)); then docker compose up -d --build; else docker compose up -d --force-recreate; fi
  echo -n "Waiting for the server"
  for _ in $(seq 60); do port_used && break; echo -n .; sleep 1; done
  echo
  funnel
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

funnel
exec npm run start:https
