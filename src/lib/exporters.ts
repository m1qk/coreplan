import { safeCell, toCsv } from './csv'
import { fmtClock, fmtClockShort, fmtDuration, fmtMinSec } from './time'
import type { ItemKind, Show, Timeline, Validation } from './types'

export const KIND_LABEL: Record<ItemKind, string> = {
  required: 'Required song',
  personal: 'DJ pick',
  mic: 'Mic break',
  station: 'Station element',
}

/** Short on-air labels, used where color alone would not be enough (print, color-blind). */
export const KIND_TAG: Record<ItemKind, string> = {
  required: 'REQ',
  personal: 'PICK',
  mic: 'MIC',
  station: 'STN',
}

export function timingText(e: Timeline['entries'][number]): string {
  if (!e.target || e.deviationSec === undefined) return ''
  const d = e.deviationSec
  if (d === 0) return 'on time'
  return `${fmtMinSec(Math.abs(d))} ${d < 0 ? 'early' : 'late'}`
}

export function rundownCsv(show: Show, timeline: Timeline): string {
  const s = show.settings
  const rows: string[][] = [
    ['Show', safeCell(s.showName || 'Untitled show')],
    ['DJ', safeCell(s.djName)],
    ['Date', s.date],
    ['Start', fmtClockShort(timeline.startSec)],
    [],
    ['Start', 'End', 'Type', 'Title', 'Artist', 'Album', 'Length', 'Due', 'Timing'],
  ]
  for (const e of timeline.entries) {
    rows.push([
      fmtClock(e.start),
      fmtClock(e.end),
      KIND_LABEL[e.item.kind],
      safeCell(e.item.title),
      safeCell(e.item.artist),
      safeCell(e.item.album),
      fmtDuration(e.durationSec),
      e.target ? fmtClock(e.target.targetSec) : '',
      timingText(e),
    ])
  }
  rows.push([])
  rows.push(['Total airtime', fmtMinSec(timeline.totalSec), 'of', fmtMinSec(timeline.showDurationSec)])
  return toCsv(rows)
}

export function fileSafeName(name: string, fallback = 'show'): string {
  const n = name
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return n || fallback
}

export function rundownFileName(show: Show, ext: string): string {
  return `${fileSafeName(show.settings.showName || 'untitled-show')}-${show.settings.date}.${ext}`
}

export function summaryLine(v: Validation): string {
  return `${v.requiredCount}/${v.requiredNeeded} required songs, ${v.micCount}/${v.micNeeded} mic breaks`
}
