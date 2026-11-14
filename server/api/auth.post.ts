import { RETRY_SEC, tryPin } from '../utils/hostAuth'

/** Enter the host PIN ({ pin }). Wrong: 401; too soon after a wrong try: 429 (data.retryAfter, s). */
export default defineEventHandler(async (event) => {
  const { pin } = (await readBody<{ pin?: unknown }>(event).catch(() => null)) ?? {}
  const r = await tryPin(event, String(pin ?? '').slice(0, 32))
  if (r === 'ok') return { ok: true }
  const wait = r === 'wrong' ? RETRY_SEC : r
  setResponseHeader(event, 'retry-after', wait)
  throw createError({
    statusCode: r === 'wrong' ? 401 : 429,
    statusMessage: r === 'wrong' ? 'Wrong PIN' : 'Too soon',
    data: { retryAfter: wait },
  })
})
