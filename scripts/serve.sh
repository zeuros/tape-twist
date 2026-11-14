#!/usr/bin/env bash
# Build, then serve the app over https on :3000 (LAN, self-signed cert) with the Tailscale
# Funnel in front of it (public https://<machine>.<tailnet>.ts.net, real cert).
# `npm run serve`; `npm run serve -- --no-build` skips the build.
set -euo pipefail
cd "$(dirname "$0")/.."

if ss -ltnH 'sport = :3000' | grep -q .; then
  echo "Port 3000 is already in use (another 'npm run serve' or 'npm run dev:https'?):" >&2
  ss -ltnpH 'sport = :3000' >&2
  exit 1
fi

[[ -f data/tls/cert.pem ]] || npm run cert
[[ "${1:-}" == --no-build ]] || npm run build

# The funnel is kept by tailscaled itself (--bg), but a funnel left from the last run sometimes
# fails once the server is back, so each start turns it off and on again.
# sudo is only needed while this user isn't the Tailscale operator
# (`sudo tailscale set --operator=$USER` once removes it).
ts() { tailscale "$@" 2>/dev/null || sudo tailscale "$@"; }
ts funnel --https=443 off >/dev/null || true # nothing to turn off on the first run
ts funnel --bg --yes https+insecure://localhost:3000 >/dev/null
tailscale funnel status | grep -E '^https://' || true

exec npm run start:https
