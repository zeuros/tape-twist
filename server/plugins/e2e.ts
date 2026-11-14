import { SINKS } from '../utils/audio'
import { engine } from '../utils/engine'
import { mixer } from '../utils/mixer'

/**
 * End-to-end tests only (EVENING_E2E=1, see test/e2e/): deck A is open in the mix without the
 * engine playing anything, so a test tone played into its sink reaches the listening pages.
 * After the engine's start-up, which closes both decks.
 */
export default defineNitroPlugin(() => {
  if (process.env.EVENING_E2E !== '1') return
  void engine.init().then(() => mixer.setDeckVolume(SINKS[0], 1))
})
