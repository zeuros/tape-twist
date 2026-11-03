import { updateEvening, type Evening } from '../utils/store'

/** Save the evening. Rejects (409, with the current version) if it changed since the client loaded it. */
export default defineEventHandler(async (event) => {
  const body = await readBody<Evening>(event)
  if (!body || !Array.isArray(body.items) || typeof body.title !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'invalid evening' })
  }
  let conflict: Evening | null = null
  const saved = await updateEvening((cur) => {
    if (typeof body.rev === 'number' && body.rev !== (cur.rev ?? 0)) {
      conflict = cur
      return cur
    }
    return {
      title: body.title.slice(0, 200),
      startTime: /^\d{2}:\d{2}$/.test(body.startTime) ? body.startTime : '20:00',
      items: body.items.slice(0, 1000),
    }
  })
  if (conflict) throw createError({ statusCode: 409, statusMessage: 'changed elsewhere', data: saved })
  return saved
})
