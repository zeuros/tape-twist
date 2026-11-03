/** Display helpers (pure functions). */

/** 245 → "4:05", 4000 → "1h06"; `empty` for 0 or unknown. */
export function formatDuration(s: number, empty = '–') {
  if (!s) return empty
  s = Math.round(s)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`
}

/** Seconds since midnight → "HH:MM" (wraps past midnight). */
export function formatClock(s: number) {
  const d = Math.floor(s / 60) % (24 * 60)
  return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`
}

/** "HH:MM" → seconds since midnight. */
export function parseClock(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 3600 + (m || 0) * 60
}

/** ISO date → "5 min ago", "3 h ago", "2 d ago". */
export function timeAgo(iso?: string) {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

/** The error message an API call failed with. */
export const errorMessage = (e: any, fallback = 'Failed') => e?.data?.statusMessage || e?.message || fallback
