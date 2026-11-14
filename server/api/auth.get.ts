import { isHost, pinLength } from '../utils/hostAuth'

/**
 * Whether this device has entered the host PIN, and the PIN's length (the lock screen submits on it).
 * End-to-end tests (TAPE_TWIST_E2E=1) skip the PIN, like the API guard does.
 */
export default defineEventHandler(async (event) => ({
  ok: process.env.TAPE_TWIST_E2E === '1' || (await isHost(event)),
  length: await pinLength(),
}))
