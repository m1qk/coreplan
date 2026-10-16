import type { ClockItem, ClockPresets } from './types'

/**
 * Station clock presets.
 *
 * Source: the station clock photo supplied for this project. Each hour type is
 * a circle with four elements around it. Read like a wall clock (top = :00,
 * right = :15, bottom = :30, left = :45):
 *
 *   EVEN hours (e.g. 2-3, 6-7)       ODD hours (e.g. 1-2, 7-8)
 *   :00  PHS Partnership (top)        :00  PHS Partnership (top)
 *   :15  Image ID        (right)      :15  PSA             (right)
 *   :30  Community Calendar (bottom)  :30  Concert Calendar (bottom)
 *   :45  Station Promo   (left)       :45  DJ Promo        (left)
 *
 * ASSUMPTIONS TO CONFIRM WITH THE STATION: the photo gives order and hour type
 * but no minute marks or lengths. The :00/:15/:30/:45 positions come from the
 * clock-face layout, and the lengths below are defaults (Station Promo 0:30
 * and Image ID 0:20 match the example in the project brief). Everything here
 * is editable in the app (Settings > Station clock) and saved per browser.
 */
export const DEFAULT_CLOCKS: ClockPresets = {
  even: [
    { key: 'phs', label: 'PHS Partnership', offsetMin: 0, durationSec: 30 },
    { key: 'image-id', label: 'Image ID', offsetMin: 15, durationSec: 20 },
    { key: 'community-calendar', label: 'Community Calendar', offsetMin: 30, durationSec: 30 },
    { key: 'station-promo', label: 'Station Promo', offsetMin: 45, durationSec: 30 },
  ],
  odd: [
    { key: 'phs', label: 'PHS Partnership', offsetMin: 0, durationSec: 30 },
    { key: 'psa', label: 'PSA', offsetMin: 15, durationSec: 30 },
    { key: 'concert-calendar', label: 'Concert Calendar', offsetMin: 30, durationSec: 30 },
    { key: 'dj-promo', label: 'DJ Promo', offsetMin: 45, durationSec: 30 },
  ],
}

export function cloneClocks(c: ClockPresets): ClockPresets {
  return { even: c.even.map((i) => ({ ...i })), odd: c.odd.map((i) => ({ ...i })) }
}

/** Every distinct station element across both presets, for the "add station element" menu. */
export function allClockElements(c: ClockPresets): ClockItem[] {
  const seen = new Map<string, ClockItem>()
  for (const item of [...c.even, ...c.odd]) if (!seen.has(item.key)) seen.set(item.key, item)
  return [...seen.values()]
}

/** Turn a label into a stable key ("Community Calendar" -> "community-calendar"). */
export function keyFromLabel(label: string): string {
  const k = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return k || 'element'
}

/** Light validation for clock edits made in the UI. Returns a cleaned copy. */
export function sanitizeClockItem(i: Partial<ClockItem>): ClockItem {
  const label = (i.label ?? '').trim() || 'Station element'
  const offset = Number.isFinite(i.offsetMin) ? Math.min(59, Math.max(0, Math.round(i.offsetMin as number))) : 0
  const dur = Number.isFinite(i.durationSec) ? Math.min(600, Math.max(5, Math.round(i.durationSec as number))) : 30
  return { key: i.key || keyFromLabel(label), label, offsetMin: offset, durationSec: dur }
}
