import { execFile } from 'node:child_process'
import { request as httpsRequest } from 'node:https'
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

/**
 * The LAN address the server answers on, e.g. https://192.168.1.175:3000 (null when there's none).
 * Whether it's https is checked once by asking ourselves on 127.0.0.1, so it's right however
 * the server was started (start:https, nuxt dev --https, plain http…).
 */
let scheme: Promise<'https' | 'http'> | null = null
export async function lanOrigin(): Promise<string | null> {
  const ip = lanAddresses().find((a) => /^(192\.168|10)\./.test(a))
  if (!ip) return null
  const port = Number(process.env.PORT || process.env.NUXT_PORT || 3000)
  scheme ??= new Promise((resolve) => {
    const req = httpsRequest({ host: '127.0.0.1', port, path: '/api/lan', rejectUnauthorized: false, timeout: 2000 }, (res) => {
      res.resume()
      resolve('https')
    })
    req.on('error', () => resolve('http')).on('timeout', () => req.destroy())
    req.end()
  })
  return `${await scheme}://${ip}:${port}`
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

/**
 * The public Funnel name (e.g. c-j.tail1234.ts.net) while `tailscale funnel` is on, else null
 * (no Tailscale, or the Funnel is off: the app is LAN-only then). Checked again after 30 s.
 */
let funnel: { value: Promise<string | null>; at: number } | null = null
export function funnelHost(): Promise<string | null> {
  if (!funnel || Date.now() - funnel.at > 30_000) {
    const value = run('tailscale', ['funnel', 'status', '--json'], { timeout: 10_000 })
      .then(({ stdout }) => {
        const on = (JSON.parse(stdout) as { AllowFunnel?: Record<string, boolean> }).AllowFunnel ?? {}
        const key = Object.keys(on).find((k) => on[k])
        return key ? key.replace(/:443$/, '') : null
      })
      .catch(() => null)
    funnel = { value, at: Date.now() }
  }
  return funnel.value
}
