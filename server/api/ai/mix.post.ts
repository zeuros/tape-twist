import { claudeMix } from '../../utils/claudeMix'

// "Ask Claude" from the top of a playlist: a one-line request → real tracks to add.
export default defineEventHandler(async (event) => {
  const b = await readBody<any>(event)
  const prompt = String(b?.prompt ?? '').trim().slice(0, 300)
  if (!prompt) throw createError({ statusCode: 400, statusMessage: 'Say what you want to hear' })
  const current = (Array.isArray(b?.current) ? b.current : []).slice(-200).map((c: any) => ({
    artist: String(c?.artist ?? '').slice(0, 100),
    title: String(c?.title ?? '').slice(0, 200),
  }))
  try {
    return await claudeMix({
      prompt,
      current,
      count: Math.max(1, Math.min(40, Math.round(Number(b?.count) || 10))),
      playlistTitle: typeof b?.playlistTitle === 'string' ? b.playlistTitle.slice(0, 100) : undefined,
    })
  } catch (e: any) {
    console.error('[claude mix]', e?.message ?? e)
    throw createError({ statusCode: 502, statusMessage: String(e?.message ?? 'Claude failed').slice(0, 200) })
  }
})
