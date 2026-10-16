// Shared data types. Everything the scheduler needs is plain data so the
// logic can be tested without React or a browser.

export type TrackRole = 'required' | 'personal'
export type ItemKind = 'required' | 'personal' | 'mic' | 'station'
export type TrackSource = 'spotify' | 'apple' | 'csv' | 'paste' | 'manual' | 'demo'
export type ClockMode = 'auto' | 'even' | 'odd'
export type Parity = 'even' | 'odd'
export type FlexMinutes = 1 | 2 | 3 | 5

/** A song in the user's music library ("crate"). */
export interface Track {
  id: string
  title: string
  artist: string
  album: string
  /** Whole seconds, or null when unknown. */
  durationSec: number | null
  /** http(s) or data:image URL. Missing artwork is drawn procedurally. */
  artwork?: string
  role: TrackRole
  source: TrackSource
  /** Id of the imported playlist this track came from. */
  playlistId?: string
}

export interface Playlist {
  id: string
  name: string
  source: TrackSource
  importedAt: string
}

/** One thing on the show rundown. Songs are snapshots of library tracks. */
export interface ShowItem {
  id: string
  kind: ItemKind
  title: string
  artist: string
  album: string
  durationSec: number | null
  artwork?: string
  trackId?: string
  /** For station elements: which clock element it satisfies (ClockItem.key). */
  stationKey?: string
  /**
   * Auto-placed station element. These are never stored on a show; the
   * scheduler derives them. Dragging one "pins" it (auto becomes false).
   */
  auto?: boolean
}

/** One element on the station clock (Image ID, PSA, ...). */
export interface ClockItem {
  key: string
  label: string
  /** Minutes past the hour at which it is due (0-59). */
  offsetMin: number
  durationSec: number
}

export interface ClockPresets {
  even: ClockItem[]
  odd: ClockItem[]
}

export interface ShowSettings {
  showName: string
  djName: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM, 24 hour */
  startTime: string
  durationMin: number
  clockMode: ClockMode
  flexMin: FlexMinutes
  autoPlace: boolean
}

export interface Show {
  id: string
  settings: ShowSettings
  /** Manual items only (songs, mic breaks, pinned station elements). */
  items: ShowItem[]
  createdAt: string
  updatedAt: string
}

/** A station clock element that is due at a specific moment of the show. */
export interface Target {
  clockKey: string
  label: string
  /** Absolute seconds since midnight of the show's start day. */
  targetSec: number
  durationSec: number
  parity: Parity
}

export type TimingStatus = 'ok' | 'early' | 'late'

export interface TimelineEntry {
  item: ShowItem
  index: number
  start: number
  end: number
  durationSec: number
  /** Present for station elements that satisfy a clock target. */
  target?: Target
  /** start - target.targetSec: negative is early, positive is late. */
  deviationSec?: number
  status?: TimingStatus
  /** Severity once the flexibility window is applied. */
  severity?: 'ok' | 'warn' | 'error'
}

export interface Timeline {
  entries: TimelineEntry[]
  startSec: number
  endSec: number
  /** Sum of all entry durations. */
  totalSec: number
  showDurationSec: number
  targets: Target[]
  /** Clock targets that did not get a station element. */
  unplaced: Target[]
}

export type IssueSeverity = 'error' | 'warn' | 'ok'

export interface Issue {
  id: string
  severity: IssueSeverity
  message: string
  /** Rundown item this issue refers to, when there is one. */
  itemId?: string
}

export interface Validation {
  issues: Issue[]
  requiredCount: number
  requiredNeeded: number
  micCount: number
  micNeeded: number
  totalSec: number
  showDurationSec: number
  remainingSec: number
  filledPct: number
  /** True when there are no errors or warnings. */
  ready: boolean
}
