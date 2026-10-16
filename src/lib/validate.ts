import type { Issue, ShowSettings, Timeline, Validation } from './types'
import { fmtClock, fmtMinSec } from './time'

export const REQUIRED_SONGS_NEEDED = 6
export const MIC_BREAKS_NEEDED = 3
/** More than this much open airtime is flagged as "too much unused". */
export const UNUSED_AIRTIME_WARN_SEC = 180

/** Check a laid-out show against station requirements. */
export function validateShow(settings: ShowSettings, timeline: Timeline): Validation {
  const issues: Issue[] = []
  const { entries, totalSec, showDurationSec } = timeline
  const flex = settings.flexMin

  const requiredCount = entries.filter((e) => e.item.kind === 'required').length
  const micCount = entries.filter((e) => e.item.kind === 'mic').length

  // Required playlist songs
  if (requiredCount < REQUIRED_SONGS_NEEDED) {
    const missing = REQUIRED_SONGS_NEEDED - requiredCount
    issues.push({
      id: 'required-count',
      severity: 'error',
      message: `Add ${missing} more required playlist song${missing === 1 ? '' : 's'} (${requiredCount} of ${REQUIRED_SONGS_NEEDED}).`,
    })
  }

  // Mic breaks
  if (micCount < MIC_BREAKS_NEEDED) {
    const n = MIC_BREAKS_NEEDED - micCount
    issues.push({
      id: 'mic-count',
      severity: 'error',
      message: `Add ${n} more mic break${n === 1 ? '' : 's'} (${micCount} of ${MIC_BREAKS_NEEDED}).`,
    })
  } else if (micCount > MIC_BREAKS_NEEDED) {
    const n = micCount - MIC_BREAKS_NEEDED
    issues.push({
      id: 'mic-count',
      severity: 'warn',
      message: `${n} extra mic break${n === 1 ? '' : 's'}. The station expects exactly ${MIC_BREAKS_NEEDED}.`,
    })
  }

  // Missing durations
  for (const e of entries) {
    if (e.item.kind === 'mic' || e.item.kind === 'station') continue
    if (!(typeof e.item.durationSec === 'number' && e.item.durationSec > 0)) {
      issues.push({
        id: `duration-${e.item.id}`,
        severity: 'error',
        itemId: e.item.id,
        message: `"${e.item.title}" has no duration, so the timeline can't be exact. Enter its length.`,
      })
    }
  }

  // Station elements: missing
  for (const tg of timeline.unplaced) {
    issues.push({
      id: `missing-${tg.clockKey}-${tg.targetSec}`,
      severity: 'warn',
      message: `${tg.label} (due about ${fmtClock(tg.targetSec)}) is not on the rundown yet.`,
    })
  }

  // Station elements: too early or late
  for (const e of entries) {
    if (!e.target || e.deviationSec === undefined || e.severity === 'ok') continue
    const dev = e.deviationSec
    const how = dev < 0 ? 'early' : 'late'
    issues.push({
      id: `timing-${e.item.id}`,
      severity: e.severity === 'error' ? 'error' : 'warn',
      itemId: e.item.id,
      message: `${e.item.title} starts ${fmtMinSec(Math.abs(dev))} ${how} (due ${fmtClock(e.target.targetSec)}, window ±${flex} min).`,
    })
  }

  // Length
  const remainingSec = showDurationSec - totalSec
  if (remainingSec < 0) {
    issues.push({
      id: 'over',
      severity: 'error',
      message: `The show runs ${fmtMinSec(-remainingSec)} over ${Math.round(showDurationSec / 60)} minutes. Trim or shorten something.`,
    })
  } else if (remainingSec > UNUSED_AIRTIME_WARN_SEC) {
    issues.push({
      id: 'unused',
      severity: 'warn',
      message: `${fmtMinSec(remainingSec)} of airtime is still open. Add music to fill the hour.`,
    })
  }

  const filledPct = showDurationSec > 0 ? Math.min(100, (totalSec / showDurationSec) * 100) : 0
  return {
    issues,
    requiredCount,
    requiredNeeded: REQUIRED_SONGS_NEEDED,
    micCount,
    micNeeded: MIC_BREAKS_NEEDED,
    totalSec,
    showDurationSec,
    remainingSec,
    filledPct,
    ready: issues.every((i) => i.severity === 'ok'),
  }
}

/** "52:35 / 60:00 scheduled, 7:25 remaining" for the airtime meter. */
export function airtimeSummary(v: Pick<Validation, 'totalSec' | 'showDurationSec' | 'remainingSec'>): {
  scheduled: string
  total: string
  tail: string
  over: boolean
} {
  const over = v.remainingSec < 0
  return {
    scheduled: fmtMinSec(v.totalSec),
    total: fmtMinSec(v.showDurationSec),
    tail: over ? `${fmtMinSec(-v.remainingSec)} over` : `${fmtMinSec(v.remainingSec)} remaining`,
    over,
  }
}
