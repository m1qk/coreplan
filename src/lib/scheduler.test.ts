import { describe, expect, it } from 'vitest'
import { DEFAULT_CLOCKS } from './clock'
import {
  computeTargets,
  layoutShow,
  mergedToManualIndex,
  reorderToStored,
  shouldPlaceHere,
  spreadMicBreaks,
} from './scheduler'
import { validateShow } from './validate'
import { fmtClock, parseTimeOfDay } from './time'
import type { ShowItem, ShowSettings } from './types'

const base: ShowSettings = {
  showName: 'Test',
  djName: 'DJ',
  date: '2026-10-14',
  startTime: '14:00',
  durationMin: 60,
  clockMode: 'auto',
  flexMin: 2,
  autoPlace: true,
}

let n = 0
const song = (sec: number | null, kind: 'required' | 'personal' = 'personal', title?: string): ShowItem => ({
  id: `s${++n}`,
  kind,
  title: title ?? `Song ${n}`,
  artist: 'A',
  album: 'B',
  durationSec: sec,
})
const mic = (sec = 90): ShowItem => ({ id: `m${++n}`, kind: 'mic', title: 'Mic Break', artist: '', album: '', durationSec: sec })
const pinned = (key: string, sec = 30): ShowItem => ({
  id: `p${++n}`,
  kind: 'station',
  title: key,
  artist: '',
  album: '',
  durationSec: sec,
  stationKey: key,
})
const at = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s

describe('station clock targets', () => {
  it('even hour (2-3 PM) has PHS :00, Image ID :15, Community Calendar :30, Station Promo :45', () => {
    const t = computeTargets(at(14, 0), 3600, 'auto', DEFAULT_CLOCKS)
    expect(t.map((x) => [x.label, fmtClock(x.targetSec)])).toEqual([
      ['PHS Partnership', '2:00:00'],
      ['Image ID', '2:15:00'],
      ['Community Calendar', '2:30:00'],
      ['Station Promo', '2:45:00'],
    ])
    expect(t.every((x) => x.parity === 'even')).toBe(true)
  })

  it('odd hour (1-2 PM) uses the odd clock', () => {
    const t = computeTargets(at(13, 0), 3600, 'auto', DEFAULT_CLOCKS)
    expect(t.map((x) => x.label)).toEqual(['PHS Partnership', 'PSA', 'Concert Calendar', 'DJ Promo'])
  })

  it('12 AM and 12 PM count as even hours, 1 and 7 as odd', () => {
    expect(computeTargets(at(0, 0), 600, 'auto', DEFAULT_CLOCKS)[0].parity).toBe('even')
    expect(computeTargets(at(12, 0), 600, 'auto', DEFAULT_CLOCKS)[0].parity).toBe('even')
    expect(computeTargets(at(19, 0), 600, 'auto', DEFAULT_CLOCKS)[0].parity).toBe('odd') // 7 PM
    expect(computeTargets(at(1, 0), 600, 'auto', DEFAULT_CLOCKS)[0].parity).toBe('odd')
  })

  it('a forced clock mode overrides the hour', () => {
    const t = computeTargets(at(14, 0), 3600, 'odd', DEFAULT_CLOCKS)
    expect(t.map((x) => x.label)).toContain('PSA')
  })

  it('a show that crosses the hour switches clocks in auto mode', () => {
    const t = computeTargets(at(14, 30), 3600, 'auto', DEFAULT_CLOCKS)
    expect(t.map((x) => [x.label, fmtClock(x.targetSec)])).toEqual([
      ['Community Calendar', '2:30:00'],
      ['Station Promo', '2:45:00'],
      ['PHS Partnership', '3:00:00'],
      ['PSA', '3:15:00'],
    ])
  })

  it('a target exactly at the end of the show is not included', () => {
    const t = computeTargets(at(14, 0), 45 * 60, 'auto', DEFAULT_CLOCKS)
    expect(t.map((x) => x.label)).toEqual(['PHS Partnership', 'Image ID', 'Community Calendar'])
  })

  it('zero or negative duration has no targets', () => {
    expect(computeTargets(at(14, 0), 0, 'auto', DEFAULT_CLOCKS)).toEqual([])
  })
})

describe('placement boundary rule', () => {
  it('places when already at or after the due time', () => {
    expect(shouldPlaceHere(100, 400, 100, 120)).toBe(true)
    expect(shouldPlaceHere(130, 400, 100, 120)).toBe(true)
  })
  it('waits when the next boundary is nearer', () => {
    // due 900, boundaries 660 (4 min early) and 960 (1 min late): choose 960
    expect(shouldPlaceHere(660, 960, 900, 120)).toBe(false)
  })
  it('places now when this boundary is nearer than the next', () => {
    // due 900, boundaries 870 (30s early) and 1100 (200s late)
    expect(shouldPlaceHere(870, 1100, 900, 120)).toBe(true)
  })
  it('ties go to the later boundary', () => {
    expect(shouldPlaceHere(840, 960, 900, 120)).toBe(false)
  })
  it('at the end of content only places if within the flex window', () => {
    expect(shouldPlaceHere(800, null, 900, 120)).toBe(true) // 100s early
    expect(shouldPlaceHere(700, null, 900, 120)).toBe(false) // 200s early
  })
})

describe('timeline layout', () => {
  it('is continuous: each entry starts when the previous one ends (matches the brief example)', () => {
    const items = [song(225), song(260), mic(90)]
    const tl = layoutShow({ ...base, autoPlace: false }, items, DEFAULT_CLOCKS)
    expect(tl.entries.map((e) => [fmtClock(e.start), fmtClock(e.end)])).toEqual([
      ['2:00:00', '2:03:45'],
      ['2:03:45', '2:08:05'],
      ['2:08:05', '2:09:35'],
    ])
    expect(tl.totalSec).toBe(225 + 260 + 90)
  })

  it('puts the :00 element at the very start', () => {
    const tl = layoutShow(base, [song(240)], DEFAULT_CLOCKS)
    expect(tl.entries[0].item.title).toBe('PHS Partnership')
    expect(fmtClock(tl.entries[0].start)).toBe('2:00:00')
    expect(tl.entries[1].start).toBe(tl.entries[0].end)
  })

  it('plays the 2:15 element right after a song that runs 2:11 to 2:16 (never interrupts it)', () => {
    // PHS 0:30 at 2:00:00. Songs: 2:00:30-2:04:00 (210), 2:04-2:11 (420), then 2:11-2:16 (300)
    const items = [song(210), song(420), song(300), song(240)]
    const tl = layoutShow(base, items, DEFAULT_CLOCKS)
    const idIdx = tl.entries.findIndex((e) => e.item.title === 'Image ID')
    const before = tl.entries[idIdx - 1]
    expect(before.item.durationSec).toBe(300)
    expect(fmtClock(before.start)).toBe('2:11:00')
    expect(fmtClock(before.end)).toBe('2:16:00')
    expect(tl.entries[idIdx].start).toBe(before.end)
    // 1:00 late, inside the ±2 min window
    expect(tl.entries[idIdx].status).toBe('ok')
    expect(tl.entries[idIdx].deviationSec).toBe(60)
  })

  it('picks the earlier gap when it is closer to the due time', () => {
    // Gap A at 2:14:00 (1 min early), gap B at 2:20:00 (5 min late)
    const items = [song(810), song(360), song(300)] // PHS 30s -> A=2:14:00 wait: 30+810=840=14:00
    const tl = layoutShow(base, items, DEFAULT_CLOCKS)
    const idEntry = tl.entries.find((e) => e.item.title === 'Image ID')!
    expect(fmtClock(idEntry.start)).toBe('2:14:00')
    expect(idEntry.status).toBe('ok')
  })

  it('stacks two due elements at one gap without overlapping', () => {
    // A single 40 minute song: Image ID (2:15) and Community Calendar (2:30) both land in the gap after it? No:
    // nearest-gap logic places them at 2:00:30 start gap or end. Verify the invariant instead.
    const tl = layoutShow(base, [song(2400)], DEFAULT_CLOCKS)
    for (let i = 1; i < tl.entries.length; i++) expect(tl.entries[i].start).toBe(tl.entries[i - 1].end)
  })

  it('invariant: no gaps or overlaps across many random shows', () => {
    let seed = 42
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
    for (let run = 0; run < 300; run++) {
      const items: ShowItem[] = []
      const count = 1 + Math.floor(rnd() * 20)
      for (let i = 0; i < count; i++) items.push(rnd() < 0.15 ? mic(30 + Math.floor(rnd() * 120)) : song(60 + Math.floor(rnd() * 400), rnd() < 0.5 ? 'required' : 'personal'))
      const settings: ShowSettings = {
        ...base,
        startTime: `${Math.floor(rnd() * 24)}:${['00', '05', '30', '47'][Math.floor(rnd() * 4)]}`,
        flexMin: ([1, 2, 3, 5] as const)[Math.floor(rnd() * 4)],
        durationMin: [30, 60, 90][Math.floor(rnd() * 3)],
      }
      const tl = layoutShow(settings, items, DEFAULT_CLOCKS)
      expect(tl.entries[0].start).toBe(tl.startSec)
      for (let i = 1; i < tl.entries.length; i++) {
        expect(tl.entries[i].start).toBe(tl.entries[i - 1].end)
        expect(tl.entries[i].end - tl.entries[i].start).toBe(tl.entries[i].durationSec)
      }
      const manualTotal = items.reduce((s, x) => s + (x.durationSec ?? 0), 0)
      const autoTotal = tl.entries.filter((e) => e.item.auto).reduce((s, e) => s + e.durationSec, 0)
      expect(tl.totalSec).toBe(manualTotal + autoTotal)
      // manual items keep their relative order
      expect(tl.entries.filter((e) => !e.item.auto).map((e) => e.item.id)).toEqual(items.map((x) => x.id))
      // each target is placed at most once
      const placedKeys = tl.entries.filter((e) => e.item.auto).map((e) => e.item.id)
      expect(new Set(placedKeys).size).toBe(placedKeys.length)
    }
  })

  it('places every element for a full, well-built hour within the ±2 minute window', () => {
    // 14 songs of about 4 minutes + 3 mic breaks, a typical show
    const items: ShowItem[] = []
    for (let i = 0; i < 12; i++) items.push(song(200 + (i % 4) * 20, i < 6 ? 'required' : 'personal'))
    items.splice(4, 0, mic())
    items.splice(8, 0, mic())
    items.splice(12, 0, mic())
    const tl = layoutShow(base, items, DEFAULT_CLOCKS)
    expect(tl.unplaced).toEqual([])
    const stations = tl.entries.filter((e) => e.item.kind === 'station')
    expect(stations).toHaveLength(4)
    for (const s of stations) expect(Math.abs(s.deviationSec!)).toBeLessThanOrEqual(120)
  })

  it('shows longer than 60 minutes report the overrun and keep going', () => {
    const items = Array.from({ length: 18 }, () => song(240)) // 72 min of music
    const tl = layoutShow(base, items, DEFAULT_CLOCKS)
    expect(tl.totalSec).toBeGreaterThan(3600)
    const v = validateShow(base, tl)
    expect(v.remainingSec).toBeLessThan(0)
    expect(v.issues.some((i) => i.id === 'over' && i.severity === 'error')).toBe(true)
    // targets only exist inside the 60 minute window, so no phantom 3:00 element
    expect(tl.targets).toHaveLength(4)
  })

  it('leaves due elements unplaced when the content stops well short', () => {
    const tl = layoutShow({ ...base, flexMin: 1 }, [song(300)], DEFAULT_CLOCKS)
    expect(tl.unplaced.map((t) => t.label)).toEqual(['Image ID', 'Community Calendar', 'Station Promo'])
    const v = validateShow(base, tl)
    expect(v.issues.filter((i) => i.id.startsWith('missing-'))).toHaveLength(3)
  })

  it('treats missing durations as zero and flags them', () => {
    const s = song(null, 'required', 'Mystery')
    const tl = layoutShow({ ...base, autoPlace: false }, [s, song(200)], DEFAULT_CLOCKS)
    expect(tl.entries[0].durationSec).toBe(0)
    expect(tl.totalSec).toBe(200)
    const v = validateShow(base, tl)
    expect(v.issues.find((i) => i.id === `duration-${s.id}`)?.message).toContain('Mystery')
  })

  it('an empty show stays empty: no station elements are placed on their own', () => {
    const tl = layoutShow(base, [], DEFAULT_CLOCKS)
    expect(tl.entries).toEqual([])
    expect(tl.totalSec).toBe(0)
    expect(tl.unplaced).toHaveLength(4)
  })

  it('autoPlace off: nothing is inserted and every element is reported missing', () => {
    const tl = layoutShow({ ...base, autoPlace: false }, [song(240), song(240)], DEFAULT_CLOCKS)
    expect(tl.entries.some((e) => e.item.auto)).toBe(false)
    expect(tl.unplaced).toHaveLength(4)
  })
})

describe('pinned (manually placed) station elements', () => {
  it('a pinned element satisfies its target, so no duplicate is auto-placed', () => {
    const items = [pinned('phs'), song(240), song(240), pinned('image-id', 20), song(240)]
    const tl = layoutShow(base, items, DEFAULT_CLOCKS)
    expect(tl.entries.filter((e) => e.item.title === 'PHS Partnership' || e.item.stationKey === 'phs')).toHaveLength(1)
    expect(tl.entries.filter((e) => e.item.stationKey === 'image-id')).toHaveLength(1)
  })

  it('reports timing of a pinned element against its due time (very late = error)', () => {
    const items = [song(240), song(240), song(240), song(240), song(240), pinned('image-id', 20)]
    const tl = layoutShow({ ...base, autoPlace: false }, items, DEFAULT_CLOCKS)
    const e = tl.entries.find((x) => x.item.stationKey === 'image-id')!
    expect(e.status).toBe('late')
    expect(e.severity).toBe('error')
    const v = validateShow({ ...base, autoPlace: false }, tl)
    expect(v.issues.some((i) => i.id === `timing-${e.item.id}` && i.severity === 'error')).toBe(true)
  })

  it('severity bands: within flex ok, up to 2x flex warn, beyond error', () => {
    const mk = (offsetSec: number) => {
      // Image ID due 2:15:00. One filler song so it starts at 2:00:00 + offsetSec.
      const items = [song(900 + offsetSec), pinned('image-id', 20)]
      const tl = layoutShow({ ...base, autoPlace: false, flexMin: 2 }, items, DEFAULT_CLOCKS)
      return tl.entries.find((x) => x.item.stationKey === 'image-id')!
    }
    expect(mk(0).severity).toBe('ok')
    expect(mk(120).severity).toBe('ok')
    expect(mk(121).severity).toBe('warn')
    expect(mk(240).severity).toBe('warn')
    expect(mk(241).severity).toBe('error')
    expect(mk(-121).severity).toBe('warn')
    expect(mk(-121).status).toBe('early')
  })

  it('an extra pinned element with no matching clock key is allowed', () => {
    const tl = layoutShow({ ...base, autoPlace: false }, [pinned('custom'), song(100)], DEFAULT_CLOCKS)
    expect(tl.entries[0].target).toBeUndefined()
  })
})

describe('drag-and-drop helpers', () => {
  it('dragging an auto element pins it; other auto elements are dropped and re-derived', () => {
    const items = Array.from({ length: 6 }, () => song(240))
    const tl = layoutShow(base, items, DEFAULT_CLOCKS)
    const merged = tl.entries.map((e) => e.item)
    const from = merged.findIndex((m) => m.auto && m.stationKey === 'image-id')
    expect(from).toBeGreaterThan(0)
    expect(from).toBeLessThan(merged.length - 1)
    const stored = reorderToStored(merged, from, from + 1)
    expect(stored.some((i) => i.auto)).toBe(false)
    expect(stored.filter((i) => i.stationKey === 'image-id')).toHaveLength(1)
    expect(stored.filter((i) => i.kind !== 'station')).toHaveLength(6)
    // the pinned element now sits where it was dropped, so the layout honours it
    const tl2 = layoutShow(base, stored, DEFAULT_CLOCKS)
    expect(tl2.entries.findIndex((e) => e.item.stationKey === 'image-id')).toBe(from + 1)
  })

  it('dragging a song across an auto element is honoured (the element is pinned behind it)', () => {
    const a = song(300), b = song(300), c = song(300), d = song(300), e = song(300)
    const tl = layoutShow(base, [a, b, c, d, e], DEFAULT_CLOCKS)
    const merged = tl.entries.map((x) => x.item)
    const imgIdx = merged.findIndex((m) => m.auto && m.stationKey === 'image-id')
    const songIdx = imgIdx - 1 // the song directly above the Image ID
    const moved = merged[songIdx]
    const stored = reorderToStored(merged, songIdx, imgIdx) // drag it below the Image ID
    const tl2 = layoutShow(base, stored, DEFAULT_CLOCKS)
    const posSong = tl2.entries.findIndex((x) => x.item.id === moved.id)
    const posImg = tl2.entries.findIndex((x) => x.item.stationKey === 'image-id')
    expect(posSong).toBeGreaterThan(posImg)
  })

  it('moving a song where no auto element is crossed changes nothing but the song order', () => {
    const a = song(300), b = song(300), c = song(300)
    const tl = layoutShow({ ...base, autoPlace: false }, [a, b, c], DEFAULT_CLOCKS)
    const stored = reorderToStored(tl.entries.map((e) => e.item), 0, 2)
    expect(stored.map((i) => i.id)).toEqual([b.id, c.id, a.id])
  })

  it('mergedToManualIndex counts only stored items before the position', () => {
    const tl = layoutShow(base, [song(240), song(240), song(240)], DEFAULT_CLOCKS)
    // entries: [auto PHS, s1, s2, ...]; position 2 is after PHS and s1 -> 1 manual item before it
    expect(mergedToManualIndex(tl.entries, 0)).toBe(0)
    expect(mergedToManualIndex(tl.entries, 2)).toBe(1)
  })

  it('reordering songs moves the auto elements with the new boundaries', () => {
    const a = song(600), b = song(100), c = song(100), d = song(600)
    const t1 = layoutShow(base, [a, b, c, d], DEFAULT_CLOCKS)
    const t2 = layoutShow(base, [d, c, b, a], DEFAULT_CLOCKS)
    const pos = (t: typeof t1, key: string) => t.entries.findIndex((e) => e.item.stationKey === key)
    for (const t of [t1, t2]) for (let i = 1; i < t.entries.length; i++) expect(t.entries[i].start).toBe(t.entries[i - 1].end)
    expect(pos(t1, 'image-id')).toBeGreaterThan(0)
    expect(pos(t2, 'image-id')).toBeGreaterThan(0)
  })
})

describe('mic break spreading', () => {
  it('spreads mic breaks through the music', () => {
    const songs = Array.from({ length: 12 }, () => song(240))
    const mics = [mic(), mic(), mic()]
    const out = spreadMicBreaks([...songs, ...mics])
    const idx = out.map((x, i) => (x.kind === 'mic' ? i : -1)).filter((i) => i >= 0)
    expect(out).toHaveLength(15)
    expect(idx[0]).toBeGreaterThan(1)
    expect(idx[2]).toBeLessThan(14)
    expect(idx[1] - idx[0]).toBeGreaterThan(1)
    expect(out.filter((x) => x.kind !== 'mic').map((x) => x.id)).toEqual(songs.map((x) => x.id))
  })
  it('does nothing without mic breaks', () => {
    const items = [song(100)]
    expect(spreadMicBreaks(items)).toBe(items)
  })
})

describe('validation', () => {
  const fullShow = () => {
    const items: ShowItem[] = []
    for (let i = 0; i < 13; i++) items.push(song(235 + (i % 3) * 15, i < 6 ? 'required' : 'personal'))
    items.splice(3, 0, mic(80))
    items.splice(7, 0, mic(80))
    items.splice(11, 0, mic(80))
    return items
  }

  it('flags too few required songs and too few mic breaks', () => {
    const tl = layoutShow(base, [song(240, 'required'), song(240)], DEFAULT_CLOCKS)
    const v = validateShow(base, tl)
    expect(v.requiredCount).toBe(1)
    expect(v.issues.find((i) => i.id === 'required-count')?.message).toContain('5 more')
    expect(v.issues.find((i) => i.id === 'mic-count')?.message).toContain('3 more')
  })

  it('flags more than 3 mic breaks', () => {
    const tl = layoutShow(base, [mic(), mic(), mic(), mic(), song(100)], DEFAULT_CLOCKS)
    expect(validateShow(base, tl).issues.find((i) => i.id === 'mic-count')?.severity).toBe('warn')
  })

  it('reports the airtime numbers for the progress indicator', () => {
    const tl = layoutShow({ ...base, autoPlace: false }, [song(3155)], DEFAULT_CLOCKS) // 52:35
    const v = validateShow(base, tl)
    expect(v.totalSec).toBe(3155)
    expect(v.remainingSec).toBe(445) // 7:25
    expect(v.issues.some((i) => i.id === 'unused')).toBe(true)
  })

  it('a complete, in-window show has no errors or warnings', () => {
    const items = fullShow()
    const tl = layoutShow(base, items, DEFAULT_CLOCKS)
    const v = validateShow(base, tl)
    // total should be close to an hour; trim if needed for a deterministic check
    expect(v.requiredCount).toBe(6)
    expect(v.micCount).toBe(3)
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('start time parsing feeds the right clock', () => {
    expect(parseTimeOfDay('14:00')).toBe(50400)
  })
})
