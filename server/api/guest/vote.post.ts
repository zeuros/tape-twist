import { guestId } from '../../utils/auth'
import { toggleVote } from '../../utils/requests'

export default defineEventHandler(async (event) => {
  const { requestId } = (await readBody<{ requestId?: string }>(event)) ?? {}
  if (!requestId) throw createError({ statusCode: 400, statusMessage: 'requestId required' })
  const r = await toggleVote(guestId(event), String(requestId))
  return { id: r.id, votes: r.votes.length }
})
