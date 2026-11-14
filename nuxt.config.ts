// The end-to-end tests build into their own folders, so they never touch a running server's build.
const e2e = process.env.TAPE_TWIST_E2E === '1'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  ...(e2e ? { buildDir: '.nuxt-e2e' } : {}),
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/css/base.css', '~/assets/css/player.css', '~/assets/css/booth.css', '~/assets/css/responsive.css'],
  app: {
    head: {
      title: 'Tape Twist',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#14111a' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },
  // The player used to live at /player: installed APKs and old QR codes still open it.
  routeRules: { '/player': { redirect: '/' } },
  nitro: {
    // Talkover on every device: server/routes/api/voice.ts.
    experimental: { websocket: true },
    // Playwright and node-web-audio-api ship native bits and must not be bundled.
    externals: { external: ['playwright', 'playwright-core', 'node-web-audio-api'] },
    ...(e2e ? { output: { dir: '.output-e2e' } } : {}),
  },
})
