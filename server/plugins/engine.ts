import { engine } from '../utils/engine'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('close', () => engine.shutdown())
})
