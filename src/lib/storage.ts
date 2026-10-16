import { DEFAULT_CLOCKS, cloneClocks, sanitizeClockItem } from './clock'
import { safeArtworkUrl } from './csv'
import { newId } from './scheduler'
import { parseTimeOfDay, todayISO } from './time'
import type {
  ClockMode,
  ClockPresets,
  FlexMinutes,
  ItemKind,
  Playlist,
  Show,
  ShowItem,
  ShowSettings,
  Track,
  TrackRole,
  TrackSource,
} from './types'

export const STORAGE_KEY = 'core-planner:v1'

/** Settings remembered for new shows ("Save as my defaults"). */
export type SavedDefaults = Pick<ShowSettings, 'showName' | 'djName' | 'startTime' | 'durationMin' | 'clockMode' | 'flexMin' | 'autoPlace'>

export interface AppState {
  shows: Show[]
  activeShowId: string
  library: Track[]
  playlists: Playlist[]
  clocks: ClockPresets
  defaults: SavedDefaults
  integrations: { spotifyClientId: string; appleToken: string }
}

export const FACTORY_DEFAULTS: SavedDefaults = {
  showName: '',
  djName: '',
  startTime: '14:00',
  durationMin: 60,
  clockMode: 'auto',
  flexMin: 2,
  autoPlace: true,
}

// --- sanitizers: never trust data from disk or from an imported file --------

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max = 300): string => (typeof v === 'string' ? v.slice(0, max) : '')
const TRACK_SOURCES: TrackSource[] = ['spotify', 'apple', 'csv', 'paste', 'manual', 'demo']

function dur(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 6 * 3600 ? Math.round(v) : null
}

export function sanitizeTrack(raw: unknown): Track | null {
  if (!isRec(raw)) return null
  const title = str(raw.title).trim()
  if (!title) return null
  return {
    id: str(raw.id, 80) || newId('trk'),
    title,
    artist: str(raw.artist).trim() || 'Unknown artist',
    album: str(raw.album).trim(),
    durationSec: dur(raw.durationSec),
    artwork: safeArtworkUrl(str(raw.artwork, 400_000)),
    role: raw.role === 'required' ? 'required' : ('personal' as TrackRole),
    source: TRACK_SOURCES.includes(raw.source as TrackSource) ? (raw.source as TrackSource) : 'manual',
    playlistId: str(raw.playlistId, 80) || undefined,
  }
}

const KINDS: ItemKind[] = ['required', 'personal', 'mic', 'station']

export function sanitizeItem(raw: unknown): ShowItem | null {
  if (!isRec(raw)) return null
  const kind = raw.kind as ItemKind
  if (!KINDS.includes(kind)) return null
  const title = str(raw.title).trim() || (kind === 'mic' ? 'Mic Break' : '')
  if (!title) return null
  return {
    id: str(raw.id, 80) || newId('itm'),
    kind,
    title,
    artist: str(raw.artist).trim(),
    album: str(raw.album).trim(),
    durationSec: dur(raw.durationSec),
    artwork: safeArtworkUrl(str(raw.artwork, 400_000)),
    trackId: str(raw.trackId, 80) || undefined,
    stationKey: kind === 'station' ? str(raw.stationKey, 80) || undefined : undefined,
    auto: false, // auto elements are derived, never stored
  }
}

export function sanitizeSettings(raw: unknown, fallback: SavedDefaults = FACTORY_DEFAULTS): ShowSettings {
  const r = isRec(raw) ? raw : {}
  const startTime = typeof r.startTime === 'string' && parseTimeOfDay(r.startTime) !== null ? r.startTime.padStart(5, '0') : fallback.startTime
  const flex = [1, 2, 3, 5].includes(r.flexMin as number) ? (r.flexMin as FlexMinutes) : fallback.flexMin
  const mode: ClockMode = ['auto', 'even', 'odd'].includes(r.clockMode as string) ? (r.clockMode as ClockMode) : fallback.clockMode
  const dm = typeof r.durationMin === 'number' && Number.isFinite(r.durationMin) ? Math.min(240, Math.max(5, Math.round(r.durationMin))) : fallback.durationMin
  return {
    showName: str(r.showName, 120),
    djName: str(r.djName, 120),
    date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : todayISO(),
    startTime,
    durationMin: dm,
    clockMode: mode,
    flexMin: flex,
    autoPlace: typeof r.autoPlace === 'boolean' ? r.autoPlace : fallback.autoPlace,
  }
}

export function sanitizeShow(raw: unknown, fallback: SavedDefaults = FACTORY_DEFAULTS): Show | null {
  if (!isRec(raw)) return null
  const now = new Date().toISOString()
  const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 500).map(sanitizeItem).filter((i): i is ShowItem => i !== null)
  const seen = new Set<string>()
  for (const it of items) {
    if (seen.has(it.id)) it.id = newId('itm')
    seen.add(it.id)
  }
  return {
    id: str(raw.id, 80) || newId('show'),
    settings: sanitizeSettings(raw.settings, fallback),
    items,
    createdAt: str(raw.createdAt, 40) || now,
    updatedAt: str(raw.updatedAt, 40) || now,
  }
}

export function sanitizeClocks(raw: unknown): ClockPresets {
  if (!isRec(raw)) return cloneClocks(DEFAULT_CLOCKS)
  const one = (v: unknown, fb: ClockPresets['even']) => {
    if (!Array.isArray(v)) return fb.map((i) => ({ ...i }))
    const items = v.slice(0, 20).filter(isRec).map((i) => sanitizeClockItem(i as never))
    // keys must be unique within a preset
    const keys = new Set<string>()
    return items.filter((i) => (keys.has(i.key) ? false : (keys.add(i.key), true)))
  }
  return { even: one(raw.even, DEFAULT_CLOCKS.even), odd: one(raw.odd, DEFAULT_CLOCKS.odd) }
}

export function sanitizePlaylist(raw: unknown): Playlist | null {
  if (!isRec(raw)) return null
  const id = str(raw.id, 80)
  if (!id) return null
  return {
    id,
    name: str(raw.name, 120) || 'Imported playlist',
    source: TRACK_SOURCES.includes(raw.source as TrackSource) ? (raw.source as TrackSource) : 'manual',
    importedAt: str(raw.importedAt, 40) || new Date().toISOString(),
  }
}

export function sanitizeDefaults(raw: unknown): SavedDefaults {
  const s = sanitizeSettings(raw, FACTORY_DEFAULTS)
  return { showName: s.showName, djName: s.djName, startTime: s.startTime, durationMin: s.durationMin, clockMode: s.clockMode, flexMin: s.flexMin, autoPlace: s.autoPlace }
}

export function sanitizeState(raw: unknown): AppState | null {
  if (!isRec(raw)) return null
  const defaults = sanitizeDefaults(raw.defaults)
  const library = (Array.isArray(raw.library) ? raw.library : []).slice(0, 10_000).map(sanitizeTrack).filter((t): t is Track => t !== null)
  const trackIds = new Set<string>()
  for (const t of library) {
    if (trackIds.has(t.id)) t.id = newId('trk')
    trackIds.add(t.id)
  }
  const shows = (Array.isArray(raw.shows) ? raw.shows : []).slice(0, 500).map((s) => sanitizeShow(s, defaults)).filter((s): s is Show => s !== null)
  if (shows.length === 0) return null
  const integ = isRec(raw.integrations) ? raw.integrations : {}
  return {
    shows,
    activeShowId: shows.some((s) => s.id === raw.activeShowId) ? (raw.activeShowId as string) : shows[0].id,
    library,
    playlists: (Array.isArray(raw.playlists) ? raw.playlists : []).map(sanitizePlaylist).filter((p): p is Playlist => p !== null),
    clocks: sanitizeClocks(raw.clocks),
    defaults,
    integrations: { spotifyClientId: str(integ.spotifyClientId, 100).trim(), appleToken: str(integ.appleToken, 4000).trim() },
  }
}

// --- load / save -------------------------------------------------------------

interface StorageLike {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

export function loadState(storage: StorageLike): AppState | null {
  let raw: string | null = null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return null // storage blocked (private mode, etc.)
  }
  if (!raw) return null
  try {
    return sanitizeState(JSON.parse(raw))
  } catch {
    try {
      // keep the unreadable data so it can be recovered by hand instead of overwritten
      storage.setItem(`${STORAGE_KEY}:corrupt`, raw)
    } catch {
      /* ignore */
    }
    return null
  }
}

export type SaveResult = { ok: true } | { ok: false; message: string }

export function saveState(storage: StorageLike, state: AppState): SaveResult {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
    return { ok: true }
  } catch (e) {
    const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)
    return {
      ok: false,
      message: quota
        ? 'This browser is out of storage space, so changes are not being saved. Export your show to keep it.'
        : 'This browser would not let the page save. Export your show to keep it.',
    }
  }
}

// --- show files (export / import) ---------------------------------------------

export const FILE_APP_ID = 'core-show-planner'

export interface ShowFile {
  app: typeof FILE_APP_ID
  version: 1
  exportedAt: string
  shows: Show[]
  tracks: Track[]
}

/** Bundle shows together with the library tracks they use, so a file is self-contained. */
export function buildShowFile(shows: Show[], library: Track[]): ShowFile {
  const used = new Set<string>()
  for (const s of shows) for (const i of s.items) if (i.trackId) used.add(i.trackId)
  return {
    app: FILE_APP_ID,
    version: 1,
    exportedAt: new Date().toISOString(),
    shows,
    tracks: library.filter((t) => used.has(t.id)),
  }
}

export class ShowFileError extends Error {}

export function parseShowFile(text: string, defaults: SavedDefaults = FACTORY_DEFAULTS): { shows: Show[]; tracks: Track[] } {
  if (text.length > 25_000_000) throw new ShowFileError('That file is too large to be a show.')
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ShowFileError("That file isn't a saved show. Choose a .json file exported from this planner.")
  }
  if (!isRec(data)) throw new ShowFileError("That file isn't a saved show.")
  // accept a single show ({show}), a list ({shows}), or the bare show object
  const rawShows = Array.isArray(data.shows) ? data.shows : isRec(data.show) ? [data.show] : isRec(data.settings) && Array.isArray(data.items) ? [data] : []
  const shows = rawShows.map((s) => sanitizeShow(s, defaults)).filter((s): s is Show => s !== null)
  if (shows.length === 0) throw new ShowFileError('No shows were found in that file.')
  const tracks = (Array.isArray(data.tracks) ? data.tracks : []).map(sanitizeTrack).filter((t): t is Track => t !== null)
  return { shows, tracks }
}
