/** Keep getting this pointer's events after it leaves the element (holds, drags). */
export function capturePointer(e: PointerEvent) {
  try {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  } catch {
    /* no active pointer (synthetic event): capture is only a nicety */
  }
}
