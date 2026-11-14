import { isHost, pinLength } from '../utils/hostAuth'

/** Whether this device has entered the host PIN, and the PIN's length (the lock screen submits on it). */
export default defineEventHandler(async (event) => ({ ok: await isHost(event), length: await pinLength() }))
