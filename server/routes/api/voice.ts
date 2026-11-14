/**
 * Talkover to every device (app/utils/voiceLink.ts): each frame of a talker's voice is passed
 * straight on to every other open socket, tagged with the talker's slot (byte 0) so each
 * listener keeps one jitter buffer per talker. Nothing is mixed or kept here.
 */
const SUB = 'voice'
const slots = new Map<string, number>()
let nextSlot = 0

export default defineWebSocketHandler({
  open(peer) {
    slots.set(peer.id, nextSlot)
    nextSlot = (nextSlot + 1) & 0xff
    peer.subscribe(SUB)
  },
  message(peer, message) {
    if (typeof message.rawData === 'string') return // pings
    const buf = Buffer.from(message.uint8Array())
    if (buf.length < 4 || buf.length > 4096) return
    buf[0] = slots.get(peer.id) ?? 0
    peer.publish(SUB, buf) // to everyone but the talker
  },
  close(peer) {
    slots.delete(peer.id)
  },
})
