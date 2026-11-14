#!/bin/sh
# Starts what the desktop provides outside Docker, then the server:
# - PulseAudio: the decks' virtual sinks live here (the app creates them with pactl).
# - Xvfb: an invisible screen for the login browser (it's seen through /player).
# - A self-signed certificate in data/tls on first start (the mic needs https on the LAN).
set -e
cd /app

export XDG_RUNTIME_DIR="/tmp/runtime-$(id -u)"
mkdir -p -m 700 "$XDG_RUNTIME_DIR"
# No default.pa: only the socket and a silent default sink (the app adds tape_twist_a/_b).
pulseaudio --daemonize=yes --exit-idle-time=-1 -n \
  --load=module-native-protocol-unix \
  --load="module-null-sink sink_name=silence" \
  --load=module-always-sink
for i in 1 2 3 4 5 6 7 8 9 10; do pactl info >/dev/null 2>&1 && break; sleep 0.3; done

Xvfb :99 -screen 0 1280x900x24 -nolisten tcp >/dev/null 2>&1 &
export DISPLAY=:99

if [ ! -f data/tls/cert.pem ]; then
  mkdir -p data/tls
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=tape-twist \
    -keyout data/tls/key.pem -out data/tls/cert.pem 2>/dev/null
fi
NITRO_SSL_CERT="$(cat data/tls/cert.pem)"
NITRO_SSL_KEY="$(cat data/tls/key.pem)"
export NITRO_SSL_CERT NITRO_SSL_KEY

exec node .output/server/index.mjs
