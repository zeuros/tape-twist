import { booth } from '../utils/booth'

export default defineEventHandler(async () =>
  (await booth.pads()).map(({ id, emoji, label, durationSec, recorded, color }) => ({ id, emoji, label, durationSec, recorded, color })),
)
