/**
 * Two taps instead of confirm(): the first tap arms `id`, a second one within 3 s confirms.
 * A dialog would freeze the page, and the live stream it feeds with it.
 */
export function useConfirmTap() {
  const armed = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined

  /** True when this tap confirms (the action should run now). */
  function confirm(id: string) {
    clearTimeout(timer)
    if (armed.value !== id) {
      armed.value = id
      timer = setTimeout(() => (armed.value = null), 3000)
      return false
    }
    armed.value = null
    return true
  }

  onBeforeUnmount(() => clearTimeout(timer))
  return { armed, confirm }
}
