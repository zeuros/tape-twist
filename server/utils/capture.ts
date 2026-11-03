import { mkdir } from 'node:fs/promises'
import { chromium, type BrowserContext, type Request } from 'playwright'
import { loadCreds, profileDir, saveCreds, type Credentials, type Platform } from './store'

interface PlatformSpec {
  home: string
  loginUrl: string
  cookieUrls: string[]
  apiMatch: (url: URL) => boolean
  authCookie: string
}

const SPECS: Record<Platform, PlatformSpec> = {
  soundcloud: {
    home: 'https://soundcloud.com/discover',
    loginUrl: 'https://soundcloud.com/signin',
    cookieUrls: ['https://soundcloud.com', 'https://api-v2.soundcloud.com'],
    apiMatch: (u) => u.hostname === 'api-v2.soundcloud.com',
    authCookie: 'oauth_token',
  },
  deezer: {
    home: 'https://www.deezer.com/',
    loginUrl: 'https://www.deezer.com/login',
    cookieUrls: ['https://www.deezer.com', 'https://deezer.com'],
    apiMatch: (u) => u.hostname === 'www.deezer.com' && u.pathname.startsWith('/ajax/gw-light.php'),
    authCookie: 'arl',
  },
}

// Headers the server recomputes or that carry auth; everything else is replayed as captured.
const DROP_HEADERS = new Set([
  'cookie', 'authorization', 'host', 'content-length', 'content-type', 'connection',
  'accept-encoding',
])

export type CaptureState =
  | { state: 'idle' }
  | { state: 'running'; interactive: boolean; startedAt: string; message: string }
  | { state: 'error'; message: string; at: string }

const states: Record<Platform, CaptureState> = {
  soundcloud: { state: 'idle' },
  deezer: { state: 'idle' },
}
const running: Partial<Record<Platform, Promise<Credentials | null>>> = {}

export const captureState = (p: Platform) => states[p]

/**
 * Open a browser on the platform's saved profile and capture fresh credentials.
 * interactive=false: headless, succeeds only if the saved profile is still logged in.
 * interactive=true: visible window on the host; waits up to 5 minutes for the user to log in.
 */
export function capture(platform: Platform, interactive: boolean): Promise<Credentials | null> {
  if (running[platform]) return running[platform]!
  const p = doCapture(platform, interactive)
    .then((c) => {
      states[platform] = { state: 'idle' }
      return c
    })
    .catch((e: Error) => {
      states[platform] = { state: 'error', message: e.message, at: new Date().toISOString() }
      return null
    })
    .finally(() => {
      delete running[platform]
    })
  running[platform] = p
  return p
}

async function doCapture(platform: Platform, interactive: boolean): Promise<Credentials> {
  const spec = SPECS[platform]
  const setMsg = (message: string) => {
    states[platform] = { state: 'running', interactive, startedAt: new Date().toISOString(), message }
  }
  setMsg(interactive ? 'Opening browser window on the host…' : 'Refreshing silently…')

  const dir = profileDir(platform)
  await mkdir(dir, { recursive: true })
  const previous = await loadCreds(platform)

  const ctx: BrowserContext = await chromium.launchPersistentContext(dir, {
    headless: !interactive,
    viewport: interactive ? null : { width: 1280, height: 800 },
    // Headless Chromium advertises "HeadlessChrome"; reuse the UA from the last headed login.
    userAgent: !interactive && previous?.userAgent ? previous.userAgent : undefined,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      // Headed Chromium on Linux encrypts cookies via the desktop keyring/portal, which
      // headless can't read, so the profile's login is lost on the next silent refresh.
      // Use the same (basic) cookie store in both modes.
      '--password-store=basic',
    ],
  })

  let apiHeaders: Record<string, string> | null = null
  let clientId: string | undefined
  ctx.on('request', async (req: Request) => {
    let url: URL
    try {
      url = new URL(req.url())
    } catch {
      return
    }
    if (!spec.apiMatch(url)) return
    const cid = url.searchParams.get('client_id')
    if (cid) clientId = cid
    try {
      const all = await req.allHeaders()
      const h: Record<string, string> = {}
      for (const [k, v] of Object.entries(all)) {
        if (!k.startsWith(':') && !DROP_HEADERS.has(k)) h[k] = v
      }
      // Prefer requests made while authenticated: they carry the full header set.
      if (!apiHeaders || all['authorization']) apiHeaders = h
    } catch {
      /* request may be gone */
    }
  })

  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(spec.home, { waitUntil: 'domcontentloaded' }).catch(() => {})

    const authCookie = async () =>
      (await ctx.cookies(spec.cookieUrls)).find((c) => c.name === spec.authCookie && c.value)

    const started = Date.now()
    const deadline = started + (interactive ? 5 * 60_000 : 25_000)
    let sentToLogin = false
    let reloaded = false
    for (;;) {
      if (Date.now() > deadline) {
        throw new Error(
          interactive ? 'Timed out waiting for login (5 min).' : 'Saved session is no longer logged in.',
        )
      }
      if (page.isClosed()) throw new Error('Browser window was closed before login completed.')

      const cookie = await authCookie()
      if (!cookie) {
        if (interactive && !sentToLogin && Date.now() - started > 4000) {
          sentToLogin = true
          setMsg('Log in in the browser window on the host machine…')
          await page.goto(spec.loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
        }
      } else {
        const needsClientId = platform === 'soundcloud' && !clientId
        if (apiHeaders && !needsClientId) break
        if (!reloaded) {
          // Logged in but no API traffic seen yet: load a page that triggers it.
          reloaded = true
          setMsg('Logged in, capturing API requests…')
          await page.goto(spec.home, { waitUntil: 'domcontentloaded' }).catch(() => {})
        }
      }
      await page.waitForTimeout(1000).catch(() => {})
    }

    const cookies: Record<string, string> = {}
    for (const c of await ctx.cookies(spec.cookieUrls)) cookies[c.name] = c.value
    const userAgent = await page.evaluate(() => navigator.userAgent)
    const headers: Record<string, string> = apiHeaders!
    headers['user-agent'] = interactive || !previous?.userAgent ? userAgent : previous.userAgent

    const creds: Credentials = {
      capturedAt: new Date().toISOString(),
      headers,
      cookies,
      userAgent: headers['user-agent'],
      clientId,
      oauthToken: platform === 'soundcloud' ? cookies.oauth_token : undefined,
    }
    await saveCreds(platform, creds)
    return creds
  } finally {
    await ctx.close().catch(() => {})
  }
}
