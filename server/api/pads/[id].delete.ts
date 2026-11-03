import { booth } from '../../utils/booth'

// Delete a pad recorded from the booth mic (the built-in ones can't be deleted).
export default defineEventHandler(async (event) => {
  if (!(await booth.deleteRecorded(String(getRouterParam(event, 'id'))))) throw createError({ statusCode: 404 })
  return { ok: true }
})
