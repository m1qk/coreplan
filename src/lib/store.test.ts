import { describe, expect, it } from 'vitest'
import { layoutShow } from './scheduler'
import { mergeTracks } from './library'
import { buildShowFile, loadState, parseShowFile, sanitizeState, saveState, ShowFileError, STORAGE_KEY } from './storage'
import { activeShow, initialState, reducer, type Action } from './store'
import { rundownCsv } from './exporters'
import { parseCsv } from './csv'
import type { Track } from './types'

const trk = (id: string, title: string, role: Track['role'], durationSec: number | null = 200): Track => ({ id, title, artist: 'Band', album: 'LP', durationSec, role, source: 'manual' })

const run = (actions: Action[], state = initialState(new Date('2026-10-14T01:00:00'))) => actions.reduce(reducer, state)

const withLibrary = (tracks: Track[]) => run([{ type: 'library/set', library: tracks, playlists: [] }])

describe('library merge', () => {
  it('adds new songs, skips duplicates (title+artist), and fills in missing details', () => {
    const lib = [trk('1', 'Song', 'personal', null)]
    const r = mergeTracks(lib, [], [
      { title: 'Song (Remastered)', artist: 'band', album: 'LP2', durationSec: 210, role: 'required' },
      { title: 'Other', artist: 'Band', album: '', durationSec: 100, role: 'required' },
    ], 'csv', 'My list')
    expect(r.added).toBe(1)
    expect(r.duplicates).toBe(1)
    expect(r.library[0].durationSec).toBe(210) // filled in
    expect(r.library[0].album).toBe('LP') // not overwritten
    expect(r.playlists).toHaveLength(1)
    expect(lib[0].durationSec).toBeNull() // input not mutated
  })
  it('does not create an empty playlist when nothing was added', () => {
    const r = mergeTracks([trk('1', 'Song', 'personal')], [], [{ title: 'Song', artist: 'Band', album: '', durationSec: 1, role: 'personal' }], 'csv', 'Empty')
    expect(r.playlists).toHaveLength(0)
  })
})

describe('show building', () => {
  it('adds a song once, as its library role, and refuses duplicates', () => {
    const s = run([{ type: 'item/addTrack', trackId: 'a' }, { type: 'item/addTrack', trackId: 'a' }], withLibrary([trk('a', 'A', 'required')]))
    expect(activeShow(s).items).toHaveLength(1)
    expect(activeShow(s).items[0]).toMatchObject({ kind: 'required', trackId: 'a', durationSec: 200 })
  })

  it('numbers mic breaks and renumbers after removal', () => {
    let s = run([{ type: 'item/addMic' }, { type: 'item/addMic' }, { type: 'item/addMic' }])
    expect(activeShow(s).items.map((i) => i.title)).toEqual(['Mic Break 1', 'Mic Break 2', 'Mic Break 3'])
    s = reducer(s, { type: 'item/remove', id: activeShow(s).items[0].id })
    expect(activeShow(s).items.map((i) => i.title)).toEqual(['Mic Break 1', 'Mic Break 2'])
  })

  it('inserts at a merged index (drag from library onto the timeline)', () => {
    const lib = ['a', 'b', 'c', 'd'].map((id) => trk(id, id.toUpperCase(), 'personal'))
    let s = run([{ type: 'item/addTrack', trackId: 'a' }, { type: 'item/addTrack', trackId: 'b' }], withLibrary(lib))
    const merged = layoutShow(activeShow(s).settings, activeShow(s).items, s.clocks).entries
    const bIdx = merged.findIndex((e) => e.item.trackId === 'b')
    s = reducer(s, { type: 'item/addTrack', trackId: 'c', atMergedIndex: bIdx }) // drop onto B: goes before it
    expect(activeShow(s).items.map((i) => i.trackId)).toEqual(['a', 'c', 'b'])
  })

  it('reorders by id and keeps durations exact', () => {
    const lib = ['a', 'b', 'c'].map((id, n) => trk(id, id, 'personal', 100 + n))
    let s = run(['a', 'b', 'c'].map((trackId) => ({ type: 'item/addTrack', trackId }) as Action), withLibrary(lib))
    s = reducer(s, { type: 'settings/update', patch: { autoPlace: false } })
    const ids = activeShow(s).items.map((i) => i.id)
    s = reducer(s, { type: 'item/reorder', activeId: ids[0], overId: ids[2] })
    expect(activeShow(s).items.map((i) => i.trackId)).toEqual(['b', 'c', 'a'])
    s = reducer(s, { type: 'item/move', id: ids[0], delta: -1 })
    expect(activeShow(s).items.map((i) => i.trackId)).toEqual(['b', 'a', 'c'])
    const tl = layoutShow(activeShow(s).settings, activeShow(s).items, s.clocks)
    expect(tl.totalSec).toBe(100 + 101 + 102)
  })

  it('editing a library track updates the scheduled copy (including role -> color)', () => {
    let s = run([{ type: 'item/addTrack', trackId: 'a' }], withLibrary([trk('a', 'A', 'personal')]))
    s = reducer(s, { type: 'track/update', id: 'a', patch: { role: 'required', durationSec: 333, title: 'A2' } })
    expect(activeShow(s).items[0]).toMatchObject({ kind: 'required', durationSec: 333, title: 'A2' })
  })

  it('editing a duration in the rundown writes back to the library', () => {
    let s = run([{ type: 'item/addTrack', trackId: 'a' }], withLibrary([trk('a', 'A', 'personal', null)]))
    s = reducer(s, { type: 'item/update', id: activeShow(s).items[0].id, patch: { durationSec: 245 } })
    expect(s.library[0].durationSec).toBe(245)
  })

  it('removing a library track removes it from the show', () => {
    let s = run([{ type: 'item/addTrack', trackId: 'a' }], withLibrary([trk('a', 'A', 'personal')]))
    s = reducer(s, { type: 'track/remove', id: 'a' })
    expect(s.library).toHaveLength(0)
    expect(activeShow(s).items).toHaveLength(0)
  })

  it('spreads mic breaks and unpins station elements', () => {
    const lib = Array.from({ length: 8 }, (_, i) => trk(`t${i}`, `T${i}`, 'personal'))
    let s = run([...lib.map((t) => ({ type: 'item/addTrack', trackId: t.id }) as Action), { type: 'item/addMic' }, { type: 'item/addMic' }, { type: 'item/addMic' }], withLibrary(lib))
    s = reducer(s, { type: 'mics/spread' })
    const idx = activeShow(s).items.map((i, n) => (i.kind === 'mic' ? n : -1)).filter((n) => n >= 0)
    expect(idx[0]).toBeGreaterThan(0)
    expect(idx[2]).toBeLessThan(10)
    s = reducer(s, { type: 'item/addStation', clockKey: 'psa', label: 'PSA', durationSec: 30 })
    s = reducer(s, { type: 'station/unpinAll' })
    expect(activeShow(s).items.some((i) => i.kind === 'station')).toBe(false)
  })
})

describe('multiple shows', () => {
  it('creates, duplicates (with new ids), switches and deletes shows', () => {
    let s = run([{ type: 'item/addMic' }, { type: 'settings/update', patch: { showName: 'Tuesday Tunes' } }])
    const first = activeShow(s)
    s = reducer(s, { type: 'show/duplicate', id: first.id })
    const copy = activeShow(s)
    expect(copy.id).not.toBe(first.id)
    expect(copy.settings.showName).toBe('Tuesday Tunes (copy)')
    expect(copy.items[0].id).not.toBe(first.items[0].id)
    s = reducer(s, { type: 'show/new' })
    expect(s.shows).toHaveLength(3)
    s = reducer(s, { type: 'show/open', id: first.id })
    expect(activeShow(s).id).toBe(first.id)
    s = reducer(s, { type: 'show/delete', id: first.id })
    expect(s.shows).toHaveLength(2)
    expect(s.shows.some((x) => x.id === s.activeShowId)).toBe(true)
  })
  it('deleting the last show leaves a fresh blank one', () => {
    const s = initialState()
    const out = reducer(s, { type: 'show/delete', id: s.shows[0].id })
    expect(out.shows).toHaveLength(1)
    expect(out.shows[0].id).not.toBe(s.shows[0].id)
  })
  it('new shows use saved defaults', () => {
    let s = run([{ type: 'settings/update', patch: { djName: 'DJ Mango', showName: 'Mango Hour', durationMin: 60, flexMin: 5 } }, { type: 'settings/saveDefaults' }, { type: 'show/new' }])
    expect(activeShow(s).settings).toMatchObject({ djName: 'DJ Mango', showName: 'Mango Hour', flexMin: 5 })
    s = reducer(s, { type: 'show/new' })
    expect(activeShow(s).items).toEqual([])
  })
})

describe('persistence', () => {
  const memory = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), data: m }
  }

  it('saves and restores everything (shows, library, clocks, defaults)', () => {
    const lib = [trk('a', 'A', 'required'), trk('b', 'B', 'personal')]
    let s = run([{ type: 'item/addTrack', trackId: 'a' }, { type: 'item/addMic' }, { type: 'settings/update', patch: { showName: 'Persist Me', djName: 'Sam' } }], withLibrary(lib))
    s = reducer(s, { type: 'integrations/set', patch: { spotifyClientId: 'abc123' } })
    const st = memory()
    expect(saveState(st, s)).toEqual({ ok: true })
    const back = loadState(st)!
    expect(back.shows[0].settings).toMatchObject({ showName: 'Persist Me', djName: 'Sam' })
    expect(back.shows[0].items.map((i) => i.title)).toEqual(['A', 'Mic Break 1'])
    expect(back.library).toHaveLength(2)
    expect(back.integrations.spotifyClientId).toBe('abc123')
    expect(back.clocks.odd.map((c) => c.label)).toContain('PSA')
  })

  it('survives corrupt storage without crashing, and keeps the bad data', () => {
    const st = memory()
    st.setItem(STORAGE_KEY, '{not json')
    expect(loadState(st)).toBeNull()
    expect(st.data.get(`${STORAGE_KEY}:corrupt`)).toBe('{not json')
  })

  it('reports a full or blocked storage instead of throwing', () => {
    const quota = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError') } }
    const r = saveState(quota, initialState())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('storage')
  })

  it('sanitizes hostile or malformed data', () => {
    const state = sanitizeState({
      shows: [{ id: 'x', settings: { showName: 'n', startTime: '99:99', flexMin: 17, durationMin: 99999, clockMode: 'weird' }, items: [{ kind: 'required', title: 'ok', durationSec: -5, artwork: 'javascript:alert(1)', auto: true }, { kind: 'bogus', title: 'bad' }, 'nope'] }],
      library: [{ title: 't', role: 'admin', artwork: 'data:text/html;base64,AAAA' }, { nothing: true }],
    })!
    const show = state.shows[0]
    expect(show.settings).toMatchObject({ startTime: '14:00', flexMin: 2, durationMin: 240, clockMode: 'auto' })
    expect(show.items).toHaveLength(1)
    expect(show.items[0]).toMatchObject({ durationSec: null, auto: false })
    expect(show.items[0].artwork).toBeUndefined()
    expect(state.library).toHaveLength(1)
    expect(state.library[0]).toMatchObject({ role: 'personal' })
    expect(state.library[0].artwork).toBeUndefined()
    expect(sanitizeState({ shows: [] })).toBeNull()
  })
})

describe('show files', () => {
  it('round-trips a show with its songs, then imports without id clashes', () => {
    const lib = [trk('a', 'A', 'required')]
    const s = run([{ type: 'item/addTrack', trackId: 'a' }, { type: 'settings/update', patch: { showName: 'Export Me' } }], withLibrary(lib))
    const file = buildShowFile([activeShow(s)], s.library)
    const parsed = parseShowFile(JSON.stringify(file))
    expect(parsed.shows[0].settings.showName).toBe('Export Me')
    expect(parsed.tracks).toHaveLength(1)
    // importing into a state that already has this show id
    const out = reducer(s, { type: 'show/import', shows: parsed.shows, tracks: parsed.tracks })
    expect(out.shows).toHaveLength(2)
    expect(new Set(out.shows.map((x) => x.id)).size).toBe(2)
    expect(out.library).toHaveLength(1) // not duplicated
  })
  it('accepts a bare show object and rejects junk with a readable error', () => {
    const s = initialState()
    expect(parseShowFile(JSON.stringify(s.shows[0])).shows).toHaveLength(1)
    expect(() => parseShowFile('hello')).toThrow(ShowFileError)
    expect(() => parseShowFile('[]')).toThrow(ShowFileError)
    expect(() => parseShowFile('{"shows":[]}')).toThrow(/No shows/)
  })
})

describe('CSV rundown export', () => {
  it('exports every row with start/end, escapes quotes, and neutralizes formulas', () => {
    const lib = [{ ...trk('a', '=EVIL("x")', 'required', 225), artist: 'Band, The' }, trk('b', 'Fine', 'personal', 260)]
    const s = run([{ type: 'item/addTrack', trackId: 'a' }, { type: 'item/addTrack', trackId: 'b' }, { type: 'item/addMic' }], withLibrary(lib))
    const show = activeShow(s)
    const tl = layoutShow({ ...show.settings, startTime: '14:00', autoPlace: false }, show.items, s.clocks)
    const rows = parseCsv(rundownCsv({ ...show, settings: { ...show.settings, startTime: '14:00', autoPlace: false } }, tl))
    const header = rows.findIndex((r) => r[0] === 'Start' && r[1] === 'End')
    expect(rows[header + 1].slice(0, 4)).toEqual(['2:00:00', '2:03:45', 'Required song', `'=EVIL("x")`])
    expect(rows[header + 1][4]).toBe('Band, The')
    expect(rows[header + 2].slice(0, 2)).toEqual(['2:03:45', '2:08:05'])
    expect(rows[header + 3][2]).toBe('Mic break')
    expect(rows.at(-1)?.[0]).toBe('Total airtime')
  })
})
