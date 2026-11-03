/**
 * Per-device preferences in localStorage ("evening.<key>"). Never throws: in private mode
 * they're just not remembered.
 */
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(`evening.${key}`)
  } catch {
    return null
  }
}

export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(`evening.${key}`, value)
  } catch {
    /* private mode */
  }
}
