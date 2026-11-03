import { fetchFavorites, NeedsLogin } from '../../utils/platforms'
import { favsFile, isPlatform, readJson, writeJson, type FavCache } from '../../utils/store'

export default defineEventHandler(async (event) => {
  const p = getRouterParam(event, 'platform')
  if (!isPlatform(p)) throw createError({ statusCode: 404 })
  const cached = await readJson<FavCache | null>(favsFile(p), null)
  if (cached && getQuery(event).refresh !== '1') return cached
  try {
    const fresh: FavCache = { fetchedAt: new Date().toISOString(), items: await fetchFavorites(p) }
    await writeJson(favsFile(p), fresh)
    return fresh
  } catch (e: any) {
    if (e instanceof NeedsLogin) throw createError({ statusCode: 409, statusMessage: 'login required' })
    throw createError({ statusCode: 502, statusMessage: e.message })
  }
})
