# Tape Twist in one container: the server, its two hidden Chromium decks, the audio sinks
# (a PulseAudio daemon inside the container: nothing plays on the host) and ffmpeg.
# Logins to Deezer / SoundCloud happen in /player (the server's browser, streamed there).
# See README → Docker.
FROM node:26-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg pulseaudio pulseaudio-utils xvfb openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Layers from the least to the most often changed, so a code change only rebuilds the app.
# Optional: "Ask Claude" runs the Claude Code CLI (token in data/claude-token, see compose).
ARG WITH_CLAUDE=1
RUN if [ "$WITH_CLAUDE" = 1 ]; then npm install -g @anthropic-ai/claude-code; fi

# Dependencies and Chromium: downloaded again only when package*.json change. The project's own
# postinstall (nuxt prepare) needs the sources, and `nuxt build` does it anyway: skipped here.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts && npm rebuild
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build

# Runs as uid 1000, usually the host user owning ./data.
RUN useradd -m -u 1000 -o app && mkdir -p /app/data && chown app /app/data
USER app
ENV HOME=/home/app HOST=0.0.0.0 PORT=3000
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker/entrypoint.sh"]
