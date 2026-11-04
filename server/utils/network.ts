import { execFile } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** The host's LAN IPv4 addresses, home-network ones (192.168.x, 10.x) first. */
export function lanAddresses(): string[] {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address)
  const home = (ip: string) => /^(192\.168|10)\./.test(ip)
  return [...ips.filter(home), ...ips.filter((ip) => !home(ip))]
}

/** The LAN address the server answers on, e.g. https://192.168.1.175:3000 (null when there's none). */
export function lanOrigin(): string | null {
  const ip = lanAddresses().find((a) => /^(192\.168|10)\./.test(a))
  if (!ip) return null
  const scheme = process.env.NITRO_SSL_CERT ? 'https' : 'http'
  return `${scheme}://${ip}:${process.env.PORT || 3000}`
}

/**
 * The home's public IPv4, as Tailscale sees it (`tailscale netcheck`, no third-party lookup).
 * Cached for 10 minutes; null when Tailscale isn't there or the check fails.
 */
let publicIp: { value: Promise<string | null>; at: number } | null = null
export function homePublicIp(): Promise<string | null> {
  if (!publicIp || Date.now() - publicIp.at > 10 * 60_000) {
    const value = run('tailscale', ['netcheck', '--format=json'], { timeout: 15_000 })
      .then(({ stdout }) => {
        const v4 = (JSON.parse(stdout) as { GlobalV4?: string }).GlobalV4 ?? ''
        return v4.split(':')[0] || null
      })
      .catch(() => null)
    publicIp = { value, at: Date.now() }
  }
  return publicIp.value
}

/** This machine's Tailscale name (e.g. c-j.tail1234.ts.net), the address Funnel publishes; null without Tailscale. */
let tsHost: Promise<string | null> | null = null
export function tailscaleHost(): Promise<string | null> {
  tsHost ??= run('tailscale', ['status', '--json'], { timeout: 10_000 })
    .then(({ stdout }) => {
      const name = (JSON.parse(stdout) as { Self?: { DNSName?: string } }).Self?.DNSName ?? ''
      return name.replace(/\.$/, '') || null
    })
    .catch(() => {
      tsHost = null // try again next time
      return null
    })
  return tsHost
}
