import type { Evening, Playlist } from '#shared/types/music'
import { updateEvening } from '../utils/store'

const clean = (p: any, i: number): Playlist | null =>
  p && typeof p.title === 'string' && Array.isArray(p.items)
    ? {
        id: typeof p.id === 'string' && p.id ? p.id.slice(0, 40) : `pl-${i}`,
        title: p.title.slice(0, 200),
        startTime: /^\d{2}:\d{2}$/.test(p.startTime) ? p.startTime : '20:00',
        items: p.items.slice(0, 1000),
      }
    : null

/** Save all playlists. Rejects (409, with the current version) if they changed since the client loaded them. */
export default defineEventHandler(async (event) => {
  const body = await readBody<Evening>(event)
  const playlists = Array.isArray(body?.playlists) ? body.playlists.slice(0, 50).map(clean) : []
  if (!playlists.length || playlists.some((p) => !p)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid evening' })
  }
  let conflict: Evening | null = null
  const saved = await updateEvening((cur) => {
    if (typeof body.rev === 'number' && body.rev !== (cur.rev ?? 0)) {
      conflict = cur
      return cur
    }
    const pls = playlists as Playlist[]
    return { playlists: pls, open: pls.some((p) => p.id === body.open) ? body.open : pls[0]!.id }
  })
  if (conflict) throw createError({ statusCode: 409, statusMessage: 'changed elsewhere', data: saved })
  return saved
})
