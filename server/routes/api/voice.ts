/**
 * Talkover to every device (app/utils/voiceLink.ts): each frame of a talker's voice is passed
 * straight on to every other open socket, tagged with the talker's slot (byte 0) so each
 * listener keeps one jitter buffer per talker. Nothing is mixed or kept here.
 */
const SUB = 'voice'
/** A voice frame: 4-byte header + 320 Int16 samples (app/utils/voiceJitter.ts). Anything else (the pings) stays here. */
const FRAME_BYTES = 4 + 320 * 2
const slots = new Map<string, number>()
let nextSlot = 0

export default defineWebSocketHandler({
  open(peer) {
    slots.set(peer.id, nextSlot)
    nextSlot = (nextSlot + 1) & 0xff
    peer.subscribe(SUB)
  },
  message(peer, message) {
    const buf = Buffer.from(message.uint8Array())
    if (buf.length !== FRAME_BYTES) return
    buf[0] = slots.get(peer.id) ?? 0
    peer.publish(SUB, buf) // to everyone but the talker
  },
  close(peer) {
    slots.delete(peer.id)
  },
})
