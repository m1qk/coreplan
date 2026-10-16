// Time helpers. All values are whole seconds unless noted.

/** "3:45" -> 225, "1:02:03" -> 3723. Returns null when it cannot be read. */
export function parseDuration(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') {
    return Number.isFinite(input) && input >= 0 ? Math.round(input) : null
  }
  const s = input.trim()
  if (!s) return null
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => p.trim())
    if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null
    const nums = parts.map(Number)
    // Seconds and minutes must be < 60 when a larger unit is present
    if (nums.length >= 2 && nums[nums.length - 1] >= 60) return null
    if (nums.length === 3 && nums[1] >= 60) return null
    let total = 0
    for (const n of nums) total = total * 60 + n
    return Math.round(total)
  }
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s))
  // "3m45s", "3 min 45 sec"
  const m = s.match(/^(?:(\d+)\s*(?:m|min|mins|minutes?))?\s*(?:(\d+)\s*(?:s|sec|secs|seconds?))?$/i)
  if (m && (m[1] || m[2])) return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)
  return null
}

/** 225 -> "3:45", 3723 -> "1:02:03". Null/NaN -> "--:--". */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '--:--'
  const neg = sec < 0
  const s = Math.round(Math.abs(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const body = h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`
  return neg ? `-${body}` : body
}

/** Like fmtDuration but always minutes:seconds ("62:10"), for airtime meters. */
export function fmtMinSec(sec: number): string {
  const neg = sec < 0
  const s = Math.round(Math.abs(sec))
  return `${neg ? '-' : ''}${Math.floor(s / 60)}:${pad(s % 60)}`
}

/** Signed offset like "+1:05" or "-0:30". */
export function fmtSigned(sec: number): string {
  const sign = sec < 0 ? '-' : '+'
  return `${sign}${fmtMinSec(Math.abs(sec))}`
}

/** Seconds since midnight -> "2:04:15" (12 hour clock, no AM/PM, like a studio log). */
export function fmtClock(secOfDay: number): string {
  const total = ((Math.round(secOfDay) % 86400) + 86400) % 86400
  const h24 = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${pad(m)}:${pad(s)}`
}

/** "2:15 PM" style, for headings. */
export function fmtClockShort(secOfDay: number): string {
  const total = ((Math.round(secOfDay) % 86400) + 86400) % 86400
  const h24 = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${pad(m)} ${h24 < 12 ? 'AM' : 'PM'}`
}

/** "14:30" -> 52200. Invalid input gives null. */
export function parseTimeOfDay(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  const s = Number(m[3] ?? 0)
  if (h > 23 || min > 59 || s > 59) return null
  return h * 3600 + min * 60 + s
}

export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Today's date as YYYY-MM-DD in local time. */
export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Next top-of-hour as HH:MM, a sensible default start for a new show. */
export function nextHourHHMM(now: Date = new Date()): string {
  return `${pad((now.getHours() + 1) % 24)}:00`
}
