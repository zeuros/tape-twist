#!/usr/bin/env bash
# Build the Android app in Docker (Dockerfile.apk) into data/tape-twist.apk, which the server
# offers at /tape-twist.apk. The app opens the server's public Funnel address.
#   ./scripts/apk.sh                     for this machine's running Funnel
#   ./scripts/apk.sh https://<host>      for another address
# Run by `./scripts/serve.sh --funnel`; cached, so it's quick when nothing changed.
# (`npm run android:apk` runs the same.)
set -euo pipefail
cd "$(dirname "$0")/.."

url=${1:-${CAP_SERVER_URL:-}}
if [ -z "$url" ]; then
  command -v tailscale >/dev/null || { echo "No address given and no Tailscale: ./scripts/apk.sh https://<host>" >&2; exit 1; }
  host=$(tailscale funnel status 2>/dev/null | sed -n 's#^https://\([^ /:]*\).*#\1#p' | head -1)
  [ -n "$host" ] || { echo "No Funnel running: start with ./scripts/serve.sh --funnel, or give the address" >&2; exit 1; }
  url="https://$host"
fi
url=${url%/}

echo "📲 Android app for $url (the first build takes a few minutes: it fetches the Android SDK)…"
export CAP_SERVER_URL=$url
docker compose --profile apk build --quiet apk
docker compose --profile apk run --rm apk
echo "📲 data/tape-twist.apk is ready, offered at $url/tape-twist.apk"
