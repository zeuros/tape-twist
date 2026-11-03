import { captureState } from '../utils/capture'
import { verify } from '../utils/platforms'
import { favsFile, loadCreds, PLATFORMS, readJson, type FavCache, type Platform } from '../utils/store'

type Check = Awaited<ReturnType<typeof verify>> & { at: number }
const checks: Partial<Record<Platform, Check>> = {}
const CHECK_TTL = 5 * 60_000

export default defineEventHandler(async (event) => {
  const recheck = getQuery(event).recheck === '1'
  return Object.fromEntries(
    await Promise.all(
      PLATFORMS.map(async (p) => {
        const creds = await loadCreds(p)
        const capture = captureState(p)
        let check = checks[p]
        if (creds && capture.state !== 'running' && (recheck || !check || Date.now() - check.at > CHECK_TTL)) {
          check = checks[p] = { ...(await verify(p)), at: Date.now() }
        }
        if (!creds) delete checks[p]
        const favs = await readJson<FavCache | null>(favsFile(p), null)
        return [
          p,
          {
            connected: !!creds,
            capturedAt: creds?.capturedAt,
            username: creds?.username,
            check: creds ? check : undefined,
            capture,
            favorites: favs ? { count: favs.items.length, fetchedAt: favs.fetchedAt } : null,
          },
        ]
      }),
    ),
  )
})
