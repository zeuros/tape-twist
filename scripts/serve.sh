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

# The funnel is kept by tailscaled itself (--bg): set once, it survives restarts and reboots.
# sudo is only needed while this user isn't the Tailscale operator
# (`sudo tailscale set --operator=$USER` once removes it).
if ! tailscale funnel status 2>/dev/null | grep -q 'localhost:3000'; then
  tailscale funnel --bg --yes https+insecure://localhost:3000 2>/dev/null \
    || sudo tailscale funnel --bg --yes https+insecure://localhost:3000
fi
tailscale funnel status | grep -E '^https://' || true

exec npm run start:https
