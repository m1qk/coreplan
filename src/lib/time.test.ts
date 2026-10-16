import { describe, expect, it } from 'vitest'
import { fmtClock, fmtClockShort, fmtDuration, fmtMinSec, fmtSigned, parseDuration, parseTimeOfDay } from './time'

describe('parseDuration', () => {
  it('reads m:ss and h:mm:ss', () => {
    expect(parseDuration('3:45')).toBe(225)
    expect(parseDuration('0:30')).toBe(30)
    expect(parseDuration('1:02:03')).toBe(3723)
    expect(parseDuration(' 4:05 ')).toBe(245)
  })
  it('reads plain seconds and numbers', () => {
    expect(parseDuration('225')).toBe(225)
    expect(parseDuration(225.4)).toBe(225)
  })
  it('reads 3m45s style', () => {
    expect(parseDuration('3m45s')).toBe(225)
    expect(parseDuration('2 min')).toBe(120)
  })
  it('rejects garbage', () => {
    expect(parseDuration('abc')).toBeNull()
    expect(parseDuration('3:75')).toBeNull()
    expect(parseDuration('')).toBeNull()
    expect(parseDuration(null)).toBeNull()
    expect(parseDuration(-4)).toBeNull()
    expect(parseDuration('1:2:3:4')).toBeNull()
  })
})

describe('formatting', () => {
  it('fmtDuration', () => {
    expect(fmtDuration(225)).toBe('3:45')
    expect(fmtDuration(3723)).toBe('1:02:03')
    expect(fmtDuration(null)).toBe('--:--')
    expect(fmtDuration(5)).toBe('0:05')
  })
  it('fmtMinSec keeps minutes above 59', () => {
    expect(fmtMinSec(3755)).toBe('62:35')
    expect(fmtMinSec(445)).toBe('7:25')
  })
  it('fmtSigned', () => {
    expect(fmtSigned(65)).toBe('+1:05')
    expect(fmtSigned(-30)).toBe('-0:30')
  })
  it('fmtClock is a 12 hour studio clock', () => {
    expect(fmtClock(14 * 3600)).toBe('2:00:00')
    expect(fmtClock(0)).toBe('12:00:00')
    expect(fmtClock(12 * 3600 + 5)).toBe('12:00:05')
    expect(fmtClock(23 * 3600 + 59 * 60 + 59)).toBe('11:59:59')
    expect(fmtClock(86400 + 30)).toBe('12:00:30') // wraps past midnight
  })
  it('fmtClockShort', () => {
    expect(fmtClockShort(14 * 3600 + 15 * 60)).toBe('2:15 PM')
    expect(fmtClockShort(0)).toBe('12:00 AM')
  })
  it('parseTimeOfDay', () => {
    expect(parseTimeOfDay('02:30')).toBe(9000)
    expect(parseTimeOfDay('24:00')).toBeNull()
    expect(parseTimeOfDay('nope')).toBeNull()
  })
})
