import { getView, type ViewInput } from '../../../utils/remoteView'
import { isPlatform } from '../../../utils/store'

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** A tap, scroll, text or key from the phone, replayed in the login browser. */
export default defineEventHandler(async (event) => {
  const p = getRouterParam(event, 'platform')
  if (!isPlatform(p)) throw createError({ statusCode: 404 })
  const b = (await readBody<any>(event)) ?? {}
  let i: ViewInput
  switch (b.type) {
    case 'click': case 'move': i = { type: b.type, x: num(b.x), y: num(b.y) }; break
    case 'wheel': i = { type: 'wheel', x: num(b.x), y: num(b.y), dx: num(b.dx), dy: num(b.dy) }; break
    case 'text': i = { type: 'text', text: String(b.text ?? '').slice(0, 500) }; break
    case 'key': i = { type: 'key', key: String(b.key ?? '') }; break
    default: throw createError({ statusCode: 400 })
  }
  const r = await getView(p)?.input(i).catch(() => undefined)
  return { ok: true, editable: r ? r.editable : undefined }
})
