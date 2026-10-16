import type {
  ClockMode,
  ClockPresets,
  Parity,
  ShowItem,
  ShowSettings,
  Target,
  Timeline,
  TimelineEntry,
} from './types'
import { parseTimeOfDay } from './time'

/**
 * Pure scheduling engine. No React, no DOM, no storage: give it settings and an
 * ordered list of items and it returns a complete timeline.
 *
 * Rules (from the station brief):
 *  - Station elements are due about every 15 minutes, but they are NOT hard
 *    deadlines. A song is never cut off to hit an exact time; the element goes
 *    in the nearest gap between items ("boundary").
 *  - Playback is continuous: every entry starts exactly when the previous ends.
 *  - If two boundaries are equally close to the due time, the later one wins
 *    (the DJ lets the song finish rather than stepping on it).
 */

/** Seconds of airtime an item takes. Unknown durations count as zero. */
export function itemDuration(item: ShowItem): number {
  const d = item.durationSec
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? Math.round(d) : 0
}

/** Which clock preset applies to a given absolute hour. */
export function parityForHour(hour: number, mode: ClockMode): Parity {
  if (mode === 'even' || mode === 'odd') return mode
  return ((hour % 2) + 2) % 2 === 0 ? 'even' : 'odd'
}

/**
 * Every station element that falls due during the show, in time order.
 * A target exactly at the start counts; one exactly at the end does not
 * (that belongs to the next DJ's hour).
 */
export function computeTargets(
  startSec: number,
  durationSec: number,
  mode: ClockMode,
  clocks: ClockPresets,
): Target[] {
  if (!(durationSec > 0)) return []
  const endSec = startSec + durationSec
  const firstHour = Math.floor(startSec / 3600)
  const lastHour = Math.floor((endSec - 1) / 3600)
  const out: Array<Target & { order: number }> = []
  for (let h = firstHour; h <= lastHour; h++) {
    const parity = parityForHour(h, mode)
    clocks[parity].forEach((c, order) => {
      const targetSec = h * 3600 + c.offsetMin * 60
      if (targetSec >= startSec && targetSec < endSec) {
        out.push({
          clockKey: c.key,
          label: c.label,
          targetSec,
          durationSec: c.durationSec,
          parity,
          order,
        })
      }
    })
  }
  out.sort((a, b) => a.targetSec - b.targetSec || a.order - b.order)
  return out.map(({ order: _order, ...t }) => t)
}

/**
 * Should a pending element due at `due` be placed at the boundary at time `t`?
 * `next` is the time of the boundary after the next item, or null at the end.
 */
export function shouldPlaceHere(t: number, next: number | null, due: number, flexSec: number): boolean {
  if (t >= due) return true // already at/after due time; waiting only makes it later
  if (next === null) return due - t <= flexSec // end of content: only if close enough
  return due - t < next - due // strictly nearer than the next boundary (ties go later)
}

export function layoutShow(settings: ShowSettings, items: ShowItem[], clocks: ClockPresets): Timeline {
  const startSec = parseTimeOfDay(settings.startTime) ?? 0
  const showDurationSec = Math.max(0, Math.round(settings.durationMin * 60))
  const flexSec = settings.flexMin * 60
  const targets = computeTargets(startSec, showDurationSec, settings.clockMode, clocks)

  // Only manual items are stored; any auto flag on input is ignored.
  const manual = items.filter((i) => !i.auto)

  // Pair pinned station elements with targets: the nth pinned element for a
  // key satisfies the nth target for that key. This avoids any dependency on
  // timings, so auto placement can never loop.
  const targetsByKey = new Map<string, number[]>()
  targets.forEach((t, i) => {
    const list = targetsByKey.get(t.clockKey) ?? []
    list.push(i)
    targetsByKey.set(t.clockKey, list)
  })
  const satisfied = new Set<number>()
  const targetOfItem = new Map<string, Target>()
  const seenPerKey = new Map<string, number>()
  for (const it of manual) {
    if (it.kind !== 'station' || !it.stationKey) continue
    const n = seenPerKey.get(it.stationKey) ?? 0
    seenPerKey.set(it.stationKey, n + 1)
    const idx = targetsByKey.get(it.stationKey)?.[n]
    if (idx !== undefined) {
      satisfied.add(idx)
      targetOfItem.set(it.id, targets[idx])
    }
  }

  const open = targets.filter((_, i) => !satisfied.has(i))
  // Nothing is placed until the DJ has put something on the air; a blank show stays blank.
  const pending = settings.autoPlace && manual.length > 0 ? open : []

  const entries: TimelineEntry[] = []
  let t = startSec
  let p = 0

  const push = (item: ShowItem, target?: Target) => {
    const d = itemDuration(item)
    entries.push({ item, index: entries.length, start: t, end: t + d, durationSec: d, target })
    t += d
  }

  const placeDue = (next: number | null) => {
    while (p < pending.length && shouldPlaceHere(t, next, pending[p].targetSec, flexSec)) {
      const tg = pending[p]
      push(autoItem(tg), tg)
      p++
    }
  }

  for (const it of manual) {
    placeDue(t + itemDuration(it))
    push(it, targetOfItem.get(it.id))
  }
  placeDue(null)

  const placedAuto = new Set(pending.slice(0, p))
  const unplaced = open.filter((tg) => !placedAuto.has(tg))

  // Timing of every station element that has a due time.
  for (const e of entries) {
    if (!e.target) continue
    const dev = e.start - e.target.targetSec
    e.deviationSec = dev
    const abs = Math.abs(dev)
    e.status = abs <= flexSec ? 'ok' : dev < 0 ? 'early' : 'late'
    e.severity = abs <= flexSec ? 'ok' : abs <= flexSec * 2 ? 'warn' : 'error'
  }

  const totalSec = t - startSec
  return {
    entries,
    startSec,
    endSec: t,
    totalSec,
    showDurationSec,
    targets,
    unplaced,
  }
}

export function autoItem(tg: Target): ShowItem {
  return {
    id: `auto-${tg.clockKey}-${tg.targetSec}`,
    kind: 'station',
    title: tg.label,
    artist: 'Station element',
    album: '',
    durationSec: tg.durationSec,
    stationKey: tg.clockKey,
    auto: true,
  }
}

export function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const copy = list.slice()
  const [moved] = copy.splice(from, 1)
  copy.splice(to, 0, moved)
  return copy
}

/** Ids of the nearest stored (non-auto) items before and after position i. */
function neighbours(list: ShowItem[], i: number): string {
  let p = i - 1
  while (p >= 0 && list[p].auto) p--
  let n = i + 1
  while (n < list.length && list[n].auto) n++
  return `${p >= 0 ? list[p].id : '^'}|${n < list.length ? list[n].id : '$'}`
}

/**
 * The DJ reordered the merged list on screen (manual items plus auto-placed
 * station elements). Turn the result back into stored items so what they see
 * is what they get:
 *  - the moved item keeps its place;
 *  - an auto element the DJ dragged, or that ended up between different songs
 *    because something was dragged across it, is pinned where it now sits;
 *  - every other auto element is dropped and will be re-derived.
 */
export function reorderToStored(merged: ShowItem[], from: number, to: number): ShowItem[] {
  if (from < 0 || to < 0 || from >= merged.length || to >= merged.length || from === to) {
    return merged.filter((i) => !i.auto)
  }
  const activeId = merged[from].id
  const before = new Map<string, string>()
  merged.forEach((it, i) => it.auto && before.set(it.id, neighbours(merged, i)))
  const moved = arrayMove(merged, from, to)
  const out: ShowItem[] = []
  moved.forEach((it, i) => {
    if (!it.auto) return void out.push(it)
    if (it.id === activeId || before.get(it.id) !== neighbours(moved, i)) {
      out.push({ ...it, auto: false, id: newId('stn') })
    }
  })
  return out
}

/** Index in the stored (manual) list that corresponds to a position in the merged list. */
export function mergedToManualIndex(entries: TimelineEntry[], mergedIndex: number): number {
  let n = 0
  for (let i = 0; i < Math.min(mergedIndex, entries.length); i++) if (!entries[i].item.auto) n++
  return n
}

let counter = 0
export function newId(prefix = 'id'): string {
  counter = (counter + 1) % 1_000_000
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${rand}${counter.toString(36)}`
}

/**
 * Spread mic breaks evenly through the songs. Removes existing mic breaks'
 * positions and re-inserts them at the song boundaries nearest 1/(n+1),
 * 2/(n+1)... of the way through the music.
 */
export function spreadMicBreaks(items: ShowItem[]): ShowItem[] {
  const mics = items.filter((i) => i.kind === 'mic')
  if (mics.length === 0) return items
  const rest = items.filter((i) => i.kind !== 'mic')
  const total = rest.reduce((s, i) => s + itemDuration(i), 0)
  const result: ShowItem[] = []
  let acc = 0
  let nextMic = 0
  const n = mics.length
  const goals = mics.map((_, k) => (total * (k + 1)) / (n + 1))
  for (let i = 0; i < rest.length; i++) {
    const it = rest[i]
    const before = acc
    const after = acc + itemDuration(it)
    // Insert before this item if the boundary before it is nearer the goal than the boundary after
    while (nextMic < n && Math.abs(before - goals[nextMic]) <= Math.abs(after - goals[nextMic])) {
      result.push(mics[nextMic++])
    }
    result.push(it)
    acc = after
  }
  while (nextMic < n) result.push(mics[nextMic++])
  return result
}
