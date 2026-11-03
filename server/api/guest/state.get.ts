import { guestId } from '../../utils/auth'
import { engine } from '../../utils/engine'
import { guestView, publicItem } from '../../utils/requests'
import { activeList, loadEvening } from '../../utils/store'

// What guests see: now playing, what's next, and the request board. No controls.
export default defineEventHandler(async (event) => {
  const me = guestId(event)
  const [snap, doc, requests] = await Promise.all([engine.snapshot(), loadEvening(), guestView(me)])
  const ev = activeList(doc, snap.currentId)
  const i = snap.currentId ? ev.items.findIndex((x) => x.id === snap.currentId) : -1
  return {
    title: ev.title,
    now: snap.current
      ? { ...publicItem(snap.current), status: snap.status, posSec: snap.posSec, durSec: snap.durSec }
      : null,
    upNext: (i >= 0 && !snap.adhoc ? ev.items.slice(i + 1, i + 6) : ev.items.slice(0, 5)).map((x) => ({
      ...publicItem(x),
      requestedBy: x.requestedBy,
    })),
    requests,
  }
})
