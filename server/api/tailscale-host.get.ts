/** The machine's Tailscale Funnel name, for the player QR code (null without Tailscale). */
export default defineEventHandler(async () => ({ host: await tailscaleHost() }))
