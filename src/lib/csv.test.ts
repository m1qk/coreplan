import { describe, expect, it } from 'vitest'
import { csvTemplate, libraryToCsv, parseCsv, parseTracklist, parseTracksCsv, safeArtworkUrl, safeCell, toCsv } from './csv'

describe('parseCsv', () => {
  it('handles quotes, commas, escaped quotes and embedded newlines', () => {
    const rows = parseCsv('a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n')
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'he said "hi"', 'line1\nline2'],
    ])
  })
  it('strips a BOM and tolerates CR-only and a missing final newline', () => {
    expect(parseCsv('﻿a,b\rc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
  it('keeps empty cells', () => {
    expect(parseCsv('a,,c\n,,')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ])
  })
  it('does not hang or crash on an unterminated quote', () => {
    expect(parseCsv('a,"b\nc')).toEqual([['a', 'b\nc']])
  })
})

describe('parseTracksCsv', () => {
  it('reads the template and applies roles', () => {
    const r = parseTracksCsv(csvTemplate(), 'personal')
    expect(r.problems.filter((p) => p.severity === 'error')).toEqual([])
    expect(r.tracks).toHaveLength(4)
    expect(r.tracks[0]).toMatchObject({ title: 'Neon Parking Lot', artist: 'Velvet Static', album: 'Midnight Laundromat', durationSec: 222, role: 'required' })
    expect(r.tracks[2].role).toBe('personal')
    expect(r.tracks[3].title).toBe('"Quotes, and commas" work')
    expect(r.tracks[3].durationSec).toBe(215) // plain seconds
  })

  it('maps an Exportify-style Spotify export (ms durations, "Artist Name(s)")', () => {
    const csv = 'Track URI,Track Name,Album Name,Artist Name(s),Release Date,Duration (ms),Popularity\n' + 'spotify:track:1,Song One,Album One,Artist A;Artist B,2020-01-01,225000,50\n'
    const r = parseTracksCsv(csv, 'required')
    expect(r.tracks[0]).toMatchObject({ title: 'Song One', artist: 'Artist A;Artist B', album: 'Album One', durationSec: 225, role: 'required' })
  })

  it('treats big unlabeled numbers as milliseconds and small ones as seconds', () => {
    const r = parseTracksCsv('title,artist,duration\nA,x,225000\nB,x,225', 'personal')
    expect(r.tracks.map((t) => t.durationSec)).toEqual([225, 225])
  })

  it('reports bad rows with line numbers instead of failing the whole file', () => {
    const csv = 'title,artist,duration\nGood,Band,3:00\n,NoTitle,2:00\nBadDur,Band,abc\n'
    const r = parseTracksCsv(csv, 'personal')
    expect(r.tracks.map((t) => t.title)).toEqual(['Good', 'BadDur'])
    expect(r.tracks[1].durationSec).toBeNull()
    expect(r.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, severity: 'error' }),
        expect.objectContaining({ row: 4, severity: 'warning' }),
      ]),
    )
  })

  it('falls back to title, artist, album, duration order without a header', () => {
    const r = parseTracksCsv('Song,Band,Rec,3:10\nOther,Band2,,2:20', 'personal')
    expect(r.tracks).toHaveLength(2)
    expect(r.tracks[0]).toMatchObject({ title: 'Song', artist: 'Band', album: 'Rec', durationSec: 190 })
    expect(r.problems[0].severity).toBe('warning')
  })

  it('an empty file is an error, not a crash', () => {
    expect(parseTracksCsv('', 'personal').problems[0].severity).toBe('error')
    expect(parseTracksCsv('\n\n  \n', 'personal').tracks).toEqual([])
  })

  it('rejects unsafe artwork links', () => {
    const r = parseTracksCsv('title,artist,artwork_url\nA,B,javascript:alert(1)\nC,D,https://example.com/a.jpg', 'personal')
    expect(r.tracks[0].artwork).toBeUndefined()
    expect(r.tracks[1].artwork).toBe('https://example.com/a.jpg')
  })

  it('role column understands common words', () => {
    const r = parseTracksCsv('title,artist,type\nA,x,Required\nB,x,station\nC,x,mine\nD,x,', 'personal')
    expect(r.tracks.map((t) => t.role)).toEqual(['required', 'required', 'personal', 'personal'])
  })
})

describe('parseTracklist', () => {
  it('reads Artist - Title with numbering and trailing durations', () => {
    const r = parseTracklist('1. Velvet Static - Neon Parking Lot (3:42)\n2) The Paper Moons - Boombox Heart [4:05]\n- Cassette Safari - Tiger in the Tape Deck', 'artist-title', 'required')
    expect(r.tracks).toEqual([
      expect.objectContaining({ artist: 'Velvet Static', title: 'Neon Parking Lot', durationSec: 222, role: 'required' }),
      expect.objectContaining({ artist: 'The Paper Moons', title: 'Boombox Heart', durationSec: 245 }),
      expect.objectContaining({ artist: 'Cassette Safari', title: 'Tiger in the Tape Deck', durationSec: null }),
    ])
  })
  it('can read Title - Artist', () => {
    const r = parseTracklist('Neon Parking Lot - Velvet Static', 'title-artist', 'personal')
    expect(r.tracks[0]).toMatchObject({ title: 'Neon Parking Lot', artist: 'Velvet Static' })
  })
  it('does not split hyphenated words or strip numbers that belong to the title', () => {
    const r = parseTracklist('Nena - 99 Luftballons\nBand - Ex-Lover', 'artist-title', 'personal')
    expect(r.tracks.map((t) => t.title)).toEqual(['99 Luftballons', 'Ex-Lover'])
  })
  it('reads tab separated Title, Artist, Album, Duration', () => {
    const r = parseTracklist('Song\tBand\tAlbum\t3:30', 'artist-title', 'personal')
    expect(r.tracks[0]).toMatchObject({ title: 'Song', artist: 'Band', album: 'Album', durationSec: 210 })
  })
  it('warns when a line has no separator and ignores blanks and comments', () => {
    const r = parseTracklist('\n# my list\nJust A Title\n', 'artist-title', 'personal')
    expect(r.tracks[0]).toMatchObject({ title: 'Just A Title', artist: 'Unknown artist' })
    expect(r.problems[0].severity).toBe('warning')
  })
  it('empty input is an error', () => {
    expect(parseTracklist('   \n', 'artist-title', 'personal').problems[0].severity).toBe('error')
  })
})

describe('export safety', () => {
  it('neutralizes spreadsheet formulas in text cells', () => {
    expect(safeCell('=HYPERLINK("http://evil")')).toBe(`'=HYPERLINK("http://evil")`)
    expect(safeCell('+1')).toBe("'+1")
    expect(safeCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(safeCell('Normal')).toBe('Normal')
  })
  it('toCsv quotes cells that need it and round-trips', () => {
    const rows = [['a', 'b,c', 'd"e', 'f\ng']]
    expect(parseCsv(toCsv(rows))).toEqual([rows[0]])
  })
  it('library export re-imports to the same songs', () => {
    const tracks = [
      { id: '1', title: 'Hello, World', artist: 'A "B"', album: 'C', durationSec: 245, role: 'required' as const, source: 'manual' as const },
      { id: '2', title: '=cmd', artist: 'X', album: '', durationSec: null, role: 'personal' as const, source: 'manual' as const },
    ]
    const back = parseTracksCsv(libraryToCsv(tracks), 'personal')
    expect(back.tracks[0]).toMatchObject({ title: 'Hello, World', artist: 'A "B"', durationSec: 245, role: 'required' })
    expect(back.tracks[1].title).toBe("'=cmd")
  })
  it('safeArtworkUrl only allows http(s) and image data URIs', () => {
    expect(safeArtworkUrl('https://x.com/a.png')).toBeTruthy()
    expect(safeArtworkUrl('data:image/png;base64,AAAA')).toBeTruthy()
    expect(safeArtworkUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeArtworkUrl('data:text/html;base64,AAAA')).toBeUndefined()
    expect(safeArtworkUrl('https://x.com/a b')).toBeUndefined()
  })
})
