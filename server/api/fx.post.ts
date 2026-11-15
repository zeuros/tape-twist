import type { ColorPreset } from '#shared/types/booth'
import { booth, COLORS } from '../utils/booth'
import { mixer } from '../utils/mixer'

interface FxCommand {
  action: 'eq' | 'color' | 'duck' | 'padVolume' | 'pitchUp' | 'pitchDown' | 'talkover' | 'echo' | 'brake' | 'rewind' | 'build' | 'gate' | 'slowmo' | 'flanger' | 'horn' | 'scratch' | 'stutter' | 'lights' | 'xy' | 'pad' | 'stopPads'
  eq?: { low?: number; mid?: number; high?: number }
  color?: ColorPreset
  value?: number
  x?: number
  y?: number
  on?: boolean
  id?: string
  /** The page that sent it: it already applied the change, so it skips its own echo. */
  from?: string
}

const num = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || 0))

export default defineEventHandler(async (event) => {
  const c = await readBody<FxCommand>(event)
  await booth.init()
  const from = typeof c?.from === 'string' ? c.from.slice(0, 40) : undefined
  switch (c?.action) {
    case 'eq': {
      const e = { ...booth.state.eq, ...c.eq }
      await booth.set({ eq: { low: num(e.low, -26, 6), mid: num(e.mid, -26, 6), high: num(e.high, -26, 6) } }, from)
      break
    }
    case 'color':
      if (!COLORS.includes(c.color as ColorPreset)) throw createError({ statusCode: 400 })
      await booth.set({ color: c.color! }, from)
      break
    case 'duck': await booth.set({ duckDb: num(c.value, 3, 30) }, from); break
    case 'padVolume': await booth.set({ padVolume: num(c.value, 0, 1.5) }, from); break
    case 'talkover': booth.hold('talkover', !!c.on, from); break
    case 'echo': booth.hold('echo', !!c.on, from); break
    case 'brake': booth.hold('brake', !!c.on, from); break
    case 'rewind': booth.hold('rewind', !!c.on, from); break
    case 'build':
    case 'gate':
    case 'slowmo':
    case 'flanger':
    case 'horn':
    case 'scratch':
      booth.hold(c.action, !!c.on, from)
      break
    case 'stutter': booth.setStutter(c.on === false ? null : Number(c.value), from); break
    case 'lights': booth.hold('lights', !!c.on, from); break
    case 'pitchUp': booth.hold('pitchUp', !!c.on, from); break
    case 'pitchDown': booth.hold('pitchDown', !!c.on, from); break
    case 'xy': booth.setXY(c.on === false ? null : { x: num(c.x, 0, 1), y: num(c.y, 0, 1) }, from); break
    case 'pad':
      if (c.on !== false && !mixer.listenerCount) {
        throw createError({ statusCode: 409, statusMessage: 'Nobody is listening: tap "Listen here" first' })
      }
      await booth.pad(String(c.id), c.on !== false, from)
      break
    case 'stopPads': booth.stopPads(from); break
    default: throw createError({ statusCode: 400, statusMessage: 'unknown action' })
  }
  return booth.state
})
