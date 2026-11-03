import { guestId } from '../../utils/auth'
import { requestTrack } from '../../utils/requests'

export default defineEventHandler(async (event) => {
  const body = (await readBody<{ itemId?: string; name?: string }>(event)) ?? {}
  if (!body.itemId) throw createError({ statusCode: 400, statusMessage: 'itemId required' })
  const r = await requestTrack(guestId(event), String(body.name ?? ''), String(body.itemId))
  return { id: r.id, status: r.status, votes: r.votes.length }
})
