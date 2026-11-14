/**
 * At start-up: print where to open the app (the dev server prints its own), and look up the
 * home's public IP so the first Funnel visitor isn't kept waiting.
 * The "Guests" line comes last: `scripts/serve.sh --docker` waits for it.
 */
export default defineNitroPlugin(() => {
  void homePublicIp()
  if (import.meta.dev || process.env.TAPE_TWIST_E2E === '1') return

  const port = Number(process.env.PORT || process.env.NITRO_PORT || 3000)
  const scheme = process.env.NITRO_SSL_CERT ? 'https' : 'http'
  setTimeout(async () => {
    const lan = lanAddresses().find((a) => /^(192\.168|10)\./.test(a)) ?? lanAddresses()[0]
    const local = `${scheme}://localhost:${port}`
    const home = lan ? `${scheme}://${lan}:${port}` : local
    const funnel = await funnelHost()
    const lines = [
      '',
      '🎧 Tape Twist is up',
      `   Local    ${local}/`,
      lan && `   LAN      ${home}/`,
      funnel && `   Funnel   https://${funnel}/   (public)`,
      `   Guests   ${funnel ? `https://${funnel}/` : `${home}/`}`,
      '',
    ]
    console.log(lines.filter((l) => typeof l === 'string').join('\n'))
  }, 300)
})
