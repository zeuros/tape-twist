export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  ssr: false,
  devtools: { enabled: false },
  app: {
    head: {
      title: 'Evening Mix',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#14111a' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },
  nitro: {
    // Playwright and node-web-audio-api ship native bits and must not be bundled.
    externals: { external: ['playwright', 'playwright-core', 'node-web-audio-api'] },
  },
})
