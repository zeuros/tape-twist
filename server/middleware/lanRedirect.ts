/**
 * A visitor who opens the Tailscale Funnel address (https://<machine>.ts.net) from the home Wi-Fi
 * would stream everything out to the internet and back. Funnel tells us the visitor's address
 * (X-Forwarded-For); when it is the home's own public IP, the visitor is on the same network, so
 * send them to the LAN address instead. Visitors on the LAN directly or through Tailscale (100.x)
 * are already local and left alone. LAN_REDIRECT=0 turns this off.
 */
export default defineEventHandler(async (event) => {
  if (process.env.LAN_REDIRECT === '0' || event.method !== 'GET') return
  const path = event.path.split('?')[0]
  if (path !== '/player') return
  if (!getRequestHost(event).endsWith('.ts.net')) return

  const client = getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim()
  if (!client || !/^\d+\.\d+\.\d+\.\d+$/.test(client)) return
  // Wait a little for the first public-IP lookup, but never hold a page for long.
  const home = await Promise.race([homePublicIp(), new Promise<null>((r) => setTimeout(() => r(null), 3000))])
  const lan = await lanOrigin()
  if (home && lan && client === home) return sendRedirect(event, lan + event.path, 302)
})
