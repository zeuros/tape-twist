import type { EngineSettings } from '#shared/types/engine'
import type { FavItem } from '#shared/types/music'
import { engine } from '../utils/engine'
import { hostStatus } from '../utils/status'

interface Command {
  action: 'play' | 'pause' | 'resume' | 'next' | 'prev' | 'seek' | 'stop' | 'crossfade' | 'settings'
  id?: string
  item?: FavItem
  value?: number
  settings?: Partial<EngineSettings>
}

export default defineEventHandler(async (event) => {
  const c = await readBody<Command>(event)
  try {
    switch (c?.action) {
      case 'play':
        if (!c.id) throw new Error('id required')
        await engine.play(c.id, c.item)
        break
      case 'pause': await engine.pause(); break
      case 'resume': await engine.resume(); break
      case 'next': await engine.skip(1); break
      case 'prev': await engine.skip(-1); break
      case 'stop': await engine.stop(); break
      case 'seek': await engine.seek(Number(c.value) || 0); break
      case 'crossfade': await engine.setSettings({ crossfade: Number(c.value) || 0 }); break
      case 'settings': await engine.setSettings(c.settings ?? {}); break
      default: throw createError({ statusCode: 400, statusMessage: 'unknown action' })
    }
  } catch (e: any) {
    if (e?.statusCode) throw e
    throw createError({ statusCode: 500, statusMessage: e.message })
  }
  return hostStatus()
})
