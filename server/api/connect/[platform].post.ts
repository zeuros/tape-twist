import { capture } from '../../utils/capture'
import { isPlatform } from '../../utils/store'

/**
 * Opens the login browser on the server ({ width, height, dpr }: the phone's screen, which
 * shows it through /api/connect/:platform/view). With a desktop, its window also opens there.
 */
export default defineEventHandler(async (event) => {
  const p = getRouterParam(event, 'platform')
  if (!isPlatform(p)) throw createError({ statusCode: 404 })
  const b = (await readBody<{ width?: unknown; height?: unknown; dpr?: unknown }>(event).catch(() => null)) ?? {}
  const n = (v: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d)
  void capture(p, true, { width: n(b.width, 320, 1600, 400), height: n(b.height, 400, 1200, 760), dpr: Math.max(1, Math.min(3, Number(b.dpr) || 1)) })
  return { started: true }
})
