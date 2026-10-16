import type { Track, TrackRole } from './types'
import { parseDuration } from './time'

export type ParsedTrack = Omit<Track, 'id' | 'playlistId' | 'source'>

export interface RowProblem {
  /** 1-based line number in the file/text (header counts as line 1). */
  row: number
  message: string
  severity: 'error' | 'warning'
}

export interface ImportResult {
  tracks: ParsedTrack[]
  problems: RowProblem[]
  /** Data rows that were read (excluding header/blank lines). */
  rowsRead: number
}

// ---------------------------------------------------------------------------
// CSV reading / writing (RFC 4180: quotes, embedded commas/newlines, "" escapes)
// ---------------------------------------------------------------------------

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? ''
  const counts: Array<[string, number]> = [',', ';', '\t', '|'].map((d) => [d, countOutsideQuotes(firstLine, d)])
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

function countOutsideQuotes(line: string, d: string): number {
  let inQ = false
  let n = 0
  for (const ch of line) {
    if (ch === '"') inQ = !inQ
    else if (ch === d && !inQ) n++
  }
  return n
}

/** Parse CSV text into rows of cells. Handles BOM, CRLF, quotes and ragged rows. */
export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.replace(/^﻿/, '')
  const d = delimiter ?? detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQ = false
  let i = 0
  const endCell = () => {
    row.push(cell)
    cell = ''
  }
  const endRow = () => {
    endCell()
    rows.push(row)
    row = []
  }
  while (i < text.length) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQ = false
        i++
        continue
      }
      cell += ch
      i++
      continue
    }
    if (ch === '"' && cell === '') {
      inQ = true
      i++
    } else if (ch === d) {
      endCell()
      i++
    } else if (ch === '\r') {
      endRow()
      i += text[i + 1] === '\n' ? 2 : 1
    } else if (ch === '\n') {
      endRow()
      i++
    } else {
      cell += ch
      i++
    }
  }
  if (cell !== '' || row.length > 0 || inQ) endRow()
  return rows
}

/**
 * Spreadsheet programs run text that starts with = + - @ as a formula. Prefix
 * such user-supplied text with an apostrophe so an exported CSV is safe to open.
 */
export function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

export function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------------------
// Track import from CSV
// ---------------------------------------------------------------------------

const ALIASES: Record<string, string[]> = {
  title: ['title', 'track', 'track name', 'trackname', 'song', 'song name', 'songname', 'name'],
  artist: ['artist', 'artists', 'artist name', 'artist name(s)', 'artistname', 'performer', 'by'],
  album: ['album', 'album name', 'albumname', 'release', 'record'],
  duration: [
    'duration',
    'length',
    'time',
    'runtime',
    'duration (ms)',
    'duration ms',
    'duration_ms',
    'durationms',
    'track duration (ms)',
    'duration (sec)',
    'duration (s)',
    'seconds',
  ],
  artwork: ['artwork', 'artwork url', 'artwork_url', 'image', 'image url', 'cover', 'cover url', 'album image url', 'album art', 'art'],
  role: ['type', 'role', 'list', 'required', 'category'],
}

function norm(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ')
}

function mapHeader(headers: string[]): Partial<Record<keyof typeof ALIASES, number>> {
  const map: Partial<Record<keyof typeof ALIASES, number>> = {}
  headers.forEach((h, idx) => {
    const n = norm(h)
    for (const [field, names] of Object.entries(ALIASES)) {
      if (names.includes(n) && map[field] === undefined) map[field] = idx
    }
  })
  return map
}

function durationFromCell(raw: string, header: string | undefined): number | null {
  const v = raw.trim()
  if (!v) return null
  const h = (header ?? '').toLowerCase()
  if (v.includes(':')) return parseDuration(v)
  if (!/^\d+(\.\d+)?$/.test(v)) return parseDuration(v)
  const num = Number(v)
  if (/\bms\b|millisecond|_ms|\(ms\)/.test(h)) return Math.round(num / 1000)
  if (/\bsec|seconds|\(s\)/.test(h)) return Math.round(num)
  // No hint: a song is rarely longer than 16 minutes, so big numbers are milliseconds.
  return num > 1000 ? Math.round(num / 1000) : Math.round(num)
}

export function roleFromCell(raw: string | undefined, fallback: TrackRole): TrackRole {
  const v = (raw ?? '').trim().toLowerCase()
  if (!v) return fallback
  if (['required', 'req', 'station', 'playlist', 'red', 'yes', 'y', 'true', '1', 'x'].includes(v)) return 'required'
  if (['personal', 'own', 'mine', 'pick', 'dj', 'blue', 'no', 'n', 'false', '0'].includes(v)) return 'personal'
  return fallback
}

export function safeArtworkUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined
  const u = url.trim()
  if (/^https?:\/\/[^\s"'<>]+$/i.test(u) && u.length < 2000) return u
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(u) && u.length < 400_000) return u
  return undefined
}

const MAX_ROWS = 5000

export function parseTracksCsv(text: string, defaultRole: TrackRole): ImportResult {
  const problems: RowProblem[] = []
  const tracks: ParsedTrack[] = []
  const rows = parseCsv(text)
  // Drop fully blank lines but remember their numbers for error messages
  const indexed = rows.map((cells, i) => ({ cells, line: i + 1 })).filter((r) => r.cells.some((c) => c.trim() !== ''))
  if (indexed.length === 0) {
    return { tracks, rowsRead: 0, problems: [{ row: 1, severity: 'error', message: 'The file is empty.' }] }
  }

  let headerMap = mapHeader(indexed[0].cells)
  let headerRow: string[] | undefined = indexed[0].cells
  let body = indexed.slice(1)
  // A real header names at least two known columns. This stops a first song that
  // happens to be called "Song" or "Time" from being mistaken for a header.
  const matched = Object.keys(headerMap).length
  const looksLikeHeader = headerMap.title !== undefined && (matched >= 2 || indexed[0].cells.length === 1)
  if (!looksLikeHeader) headerMap = {}
  if (headerMap.title === undefined) {
    // No recognizable header: assume the column order Title, Artist, Album, Duration
    if (indexed[0].cells.length >= 2) {
      headerMap = { title: 0, artist: 1, album: 2, duration: 3 }
      headerRow = undefined
      body = indexed
      problems.push({
        row: 1,
        severity: 'warning',
        message: 'No header row found. Assuming columns: title, artist, album, duration.',
      })
    } else {
      return {
        tracks,
        rowsRead: 0,
        problems: [{ row: indexed[0].line, severity: 'error', message: 'Could not find a "title" column. Use the CSV template.' }],
      }
    }
  }

  if (body.length > MAX_ROWS) {
    problems.push({ row: 1, severity: 'warning', message: `Only the first ${MAX_ROWS} rows were read.` })
    body = body.slice(0, MAX_ROWS)
  }

  const cell = (cells: string[], field: keyof typeof ALIASES): string => {
    const idx = headerMap[field]
    return idx === undefined ? '' : (cells[idx] ?? '').trim()
  }

  for (const { cells, line } of body) {
    const title = cell(cells, 'title')
    if (!title) {
      problems.push({ row: line, severity: 'error', message: 'Skipped: no song title.' })
      continue
    }
    const artist = cell(cells, 'artist')
    if (!artist) problems.push({ row: line, severity: 'warning', message: `"${title}" has no artist.` })

    const durRaw = cell(cells, 'duration')
    const durHeader = headerRow && headerMap.duration !== undefined ? headerRow[headerMap.duration] : undefined
    let durationSec = durationFromCell(durRaw, durHeader)
    if (durRaw && durationSec === null) {
      problems.push({ row: line, severity: 'warning', message: `"${title}": could not read the duration "${durRaw}". Enter it by hand.` })
    }
    if (durationSec !== null && (durationSec <= 0 || durationSec > 3 * 3600)) {
      problems.push({ row: line, severity: 'warning', message: `"${title}": duration ${durRaw} looks wrong. Check it.` })
      if (durationSec <= 0) durationSec = null
    }

    const artRaw = cell(cells, 'artwork')
    const artwork = safeArtworkUrl(artRaw)
    if (artRaw && !artwork) problems.push({ row: line, severity: 'warning', message: `"${title}": artwork link was ignored (must be http, https or an image).` })

    tracks.push({
      title: clip(title),
      artist: clip(artist) || 'Unknown artist',
      album: clip(cell(cells, 'album')),
      durationSec,
      artwork,
      role: roleFromCell(cell(cells, 'role'), defaultRole),
    })
  }
  return { tracks, problems, rowsRead: body.length }
}

function clip(s: string, max = 300): string {
  return s.length > max ? s.slice(0, max) : s
}

// ---------------------------------------------------------------------------
// Pasted tracklists
// ---------------------------------------------------------------------------

export type TracklistOrder = 'artist-title' | 'title-artist'

/**
 * Accepts one song per line, for example:
 *   Artist - Title (3:45)
 *   2. Artist - Title
 *   Title<TAB>Artist<TAB>Album<TAB>3:45
 */
export function parseTracklist(text: string, order: TracklistOrder, defaultRole: TrackRole): ImportResult {
  const problems: RowProblem[] = []
  const tracks: ParsedTrack[] = []
  let rowsRead = 0
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/)
  lines.forEach((raw, i) => {
    const lineNo = i + 1
    let line = raw.trim()
    if (!line || line.startsWith('#')) return
    rowsRead++
    // list markers: "1.", "12)", "- ", "* ", bullets
    line = line.replace(/^(?:\d{1,3}[.)\]:]\s+|[-*•·]\s+)/, '')

    if (line.includes('\t')) {
      const [title = '', artist = '', album = '', dur = ''] = line.split('\t').map((c) => c.trim())
      if (!title) return void problems.push({ row: lineNo, severity: 'error', message: 'Skipped: no song title.' })
      const d = dur ? parseDuration(dur) : null
      if (dur && d === null) problems.push({ row: lineNo, severity: 'warning', message: `"${title}": could not read duration "${dur}".` })
      tracks.push({ title: clip(title), artist: clip(artist) || 'Unknown artist', album: clip(album), durationSec: d, role: defaultRole })
      return
    }

    let durationSec: number | null = null
    const dm = line.match(/[\s(\[]+(\d{1,2}:\d{2}(?::\d{2})?)[)\]]?\s*$/)
    if (dm) {
      durationSec = parseDuration(dm[1])
      line = line.slice(0, dm.index).trim()
    }

    const sep = line.match(/\s[-–—|]\s/)
    let a = ''
    let t = ''
    if (sep && sep.index !== undefined) {
      const left = line.slice(0, sep.index).trim()
      const right = line.slice(sep.index + sep[0].length).trim()
      if (order === 'artist-title') {
        a = left
        t = right
      } else {
        t = left
        a = right
      }
    } else {
      t = line
      problems.push({ row: lineNo, severity: 'warning', message: `"${line}": no " - " separator, so no artist was found.` })
    }
    if (!t) return void problems.push({ row: lineNo, severity: 'error', message: 'Skipped: no song title.' })
    tracks.push({ title: clip(t), artist: clip(a) || 'Unknown artist', album: '', durationSec, role: defaultRole })
  })
  if (tracks.length === 0 && problems.length === 0) {
    problems.push({ row: 1, severity: 'error', message: 'Nothing to import. Paste one song per line.' })
  }
  return { tracks, problems, rowsRead }
}

// ---------------------------------------------------------------------------
// Template + library export
// ---------------------------------------------------------------------------

export const CSV_TEMPLATE_HEADER = ['title', 'artist', 'album', 'duration', 'type', 'artwork_url']

/** Sample rows use made-up artists so no real song is misrepresented. */
export function csvTemplate(): string {
  return toCsv([
    CSV_TEMPLATE_HEADER,
    ['Neon Parking Lot', 'Velvet Static', 'Midnight Laundromat', '3:42', 'required', ''],
    ['Boombox Heart', 'The Paper Moons', 'Skate Wax Sessions', '4:05', 'required', ''],
    ['Tiger in the Tape Deck', 'Cassette Safari', 'Rewind Club', '2:58', 'personal', ''],
    ['"Quotes, and commas" work', 'Gold Fish Radio', '', '215', 'personal', ''],
  ])
}

export function libraryToCsv(tracks: Track[]): string {
  const rows: string[][] = [CSV_TEMPLATE_HEADER]
  for (const t of tracks) {
    rows.push([
      safeCell(t.title),
      safeCell(t.artist),
      safeCell(t.album),
      t.durationSec ? `${Math.floor(t.durationSec / 60)}:${String(t.durationSec % 60).padStart(2, '0')}` : '',
      t.role,
      t.artwork && !t.artwork.startsWith('data:') ? t.artwork : '',
    ])
  }
  return toCsv(rows)
}
