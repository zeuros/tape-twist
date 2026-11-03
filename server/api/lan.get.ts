import { networkInterfaces } from 'node:os'

/** The host's LAN IPv4 addresses, so the player can show guests a link that works. */
export default defineEventHandler(() =>
  Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address),
)
