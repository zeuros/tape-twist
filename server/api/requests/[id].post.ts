import { decide } from '../../utils/requests'

export default defineEventHandler(async (event) => {
  const { action } = (await readBody<{ action?: string }>(event)) ?? {}
  if (action !== 'approve' && action !== 'reject') throw createError({ statusCode: 400, statusMessage: 'approve or reject' })
  const r = await decide(getRouterParam(event, 'id')!, action)
  return { id: r.id, status: r.status }
})
