import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The Android app is a shell around the live server: it opens CAP_SERVER_URL/player (the
 * Tailscale Funnel address `npm run serve` prints), so it always runs the server's current
 * build and its relative /api calls just work. `native/www` is only shown if that fails.
 * Set the URL when syncing: `CAP_SERVER_URL=https://<machine>.<tailnet>.ts.net npm run android:sync`.
 */
const server = process.env.CAP_SERVER_URL?.replace(/\/$/, '')

const config: CapacitorConfig = {
  appId: 'app.tapetwist.player',
  appName: 'Tape Twist',
  webDir: 'native/www',
  ...(server ? { server: { url: `${server}/player`, errorPath: 'index.html' } } : {}),
  android: {
    backgroundColor: '#14111a',
  },
}

export default config
