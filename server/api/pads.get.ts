import { booth } from '../utils/booth'

export default defineEventHandler(async () =>
  (await booth.pads()).map(({ id, emoji, label, durationSec }) => ({ id, emoji, label, durationSec })),
)
