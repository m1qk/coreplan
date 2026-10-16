import { DEFAULT_CLOCKS, cloneClocks } from './clock'
import { arrayMove, layoutShow, mergedToManualIndex, newId, reorderToStored, spreadMicBreaks } from './scheduler'
import { FACTORY_DEFAULTS, type AppState, type SavedDefaults } from './storage'
import { nextHourHHMM, todayISO } from './time'
import type { ClockPresets, Playlist, Show, ShowItem, ShowSettings, Track } from './types'

export type TrackPatch = Partial<Pick<Track, 'title' | 'artist' | 'album' | 'durationSec' | 'artwork' | 'role'>>
export type ItemPatch = Partial<Pick<ShowItem, 'title' | 'artist' | 'album' | 'durationSec'>>

export type Action =
  | { type: 'hydrate'; state: AppState }
  | { type: 'settings/update'; patch: Partial<ShowSettings> }
  | { type: 'settings/saveDefaults' }
  | { type: 'clocks/set'; clocks: ClockPresets }
  | { type: 'library/set'; library: Track[]; playlists: Playlist[] }
  | { type: 'track/update'; id: string; patch: TrackPatch }
  | { type: 'tracks/bulkUpdate'; updates: Array<{ id: string; patch: TrackPatch }> }
  | { type: 'track/remove'; id: string }
  | { type: 'playlist/remove'; id: string }
  | { type: 'item/addTrack'; trackId: string; atMergedIndex?: number }
  | { type: 'item/addMic' }
  | { type: 'item/addStation'; clockKey: string; label: string; durationSec: number }
  | { type: 'item/remove'; id: string }
  | { type: 'item/removeTrack'; trackId: string }
  | { type: 'item/update'; id: string; patch: ItemPatch }
  | { type: 'item/reorder'; activeId: string; overId: string }
  | { type: 'item/move'; id: string; delta: -1 | 1 }
  | { type: 'show/clearItems' }
  | { type: 'mics/spread' }
  | { type: 'station/unpinAll' }
  | { type: 'show/new' }
  | { type: 'show/open'; id: string }
  | { type: 'show/duplicate'; id: string }
  | { type: 'show/delete'; id: string }
  | { type: 'show/import'; shows: Show[]; tracks: Track[] }
  | { type: 'integrations/set'; patch: Partial<AppState['integrations']> }

export function newShow(defaults: SavedDefaults, now: Date = new Date()): Show {
  const iso = now.toISOString()
  return {
    id: newId('show'),
    settings: {
      showName: defaults.showName,
      djName: defaults.djName,
      date: todayISO(now),
      startTime: defaults.startTime === FACTORY_DEFAULTS.startTime && !defaults.showName ? nextHourHHMM(now) : defaults.startTime,
      durationMin: defaults.durationMin,
      clockMode: defaults.clockMode,
      flexMin: defaults.flexMin,
      autoPlace: defaults.autoPlace,
    },
    items: [],
    createdAt: iso,
    updatedAt: iso,
  }
}

export function initialState(now: Date = new Date()): AppState {
  const show = newShow(FACTORY_DEFAULTS, now)
  return {
    shows: [show],
    activeShowId: show.id,
    library: [],
    playlists: [],
    clocks: cloneClocks(DEFAULT_CLOCKS),
    defaults: { ...FACTORY_DEFAULTS },
    integrations: { spotifyClientId: '', appleToken: '' },
  }
}

export function activeShow(state: AppState): Show {
  return state.shows.find((s) => s.id === state.activeShowId) ?? state.shows[0]
}

function withShow(state: AppState, fn: (show: Show) => Show): AppState {
  const cur = activeShow(state)
  const next = fn(cur)
  if (next === cur) return state
  const stamped = { ...next, updatedAt: new Date().toISOString() }
  return { ...state, shows: state.shows.map((s) => (s.id === cur.id ? stamped : s)) }
}

const MIC_TITLE = 'Mic Break'

function micItem(n: number): ShowItem {
  return { id: newId('mic'), kind: 'mic', title: `${MIC_TITLE} ${n}`, artist: '', album: '', durationSec: 90 }
}

/** Keep mic break names numbered 1, 2, 3 in the order they appear. */
function renumberMics(items: ShowItem[]): ShowItem[] {
  let n = 0
  let changed = false
  const out = items.map((i) => {
    if (i.kind !== 'mic' || !/^Mic Break( \d+)?$/.test(i.title)) return i
    n++
    const title = `${MIC_TITLE} ${n}`
    if (title === i.title) return i
    changed = true
    return { ...i, title }
  })
  return changed ? out : items
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'hydrate':
      return action.state

    case 'settings/update':
      return withShow(state, (s) => ({ ...s, settings: { ...s.settings, ...action.patch } }))

    case 'settings/saveDefaults': {
      const s = activeShow(state).settings
      return {
        ...state,
        defaults: { showName: s.showName, djName: s.djName, startTime: s.startTime, durationMin: s.durationMin, clockMode: s.clockMode, flexMin: s.flexMin, autoPlace: s.autoPlace },
      }
    }

    case 'clocks/set':
      return { ...state, clocks: action.clocks }

    case 'library/set':
      return { ...state, library: action.library, playlists: action.playlists }

    case 'track/update': {
      const library = state.library.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t))
      return applyTrackChangesToShow({ ...state, library }, [action.id])
    }

    case 'tracks/bulkUpdate': {
      const patches = new Map(action.updates.map((u) => [u.id, u.patch]))
      const library = state.library.map((t) => (patches.has(t.id) ? { ...t, ...patches.get(t.id) } : t))
      return applyTrackChangesToShow({ ...state, library }, [...patches.keys()])
    }

    case 'track/remove': {
      const next = withShow({ ...state, library: state.library.filter((t) => t.id !== action.id) }, (s) => {
        const items = s.items.filter((i) => i.trackId !== action.id)
        return items.length === s.items.length ? s : { ...s, items: renumberMics(items) }
      })
      return next
    }

    case 'playlist/remove': {
      const removed = new Set(state.library.filter((t) => t.playlistId === action.id).map((t) => t.id))
      const base: AppState = {
        ...state,
        playlists: state.playlists.filter((p) => p.id !== action.id),
        library: state.library.filter((t) => t.playlistId !== action.id),
      }
      return withShow(base, (s) => {
        const items = s.items.filter((i) => !(i.trackId && removed.has(i.trackId)))
        return items.length === s.items.length ? s : { ...s, items }
      })
    }

    case 'item/addTrack': {
      const track = state.library.find((t) => t.id === action.trackId)
      if (!track) return state
      return withShow(state, (s) => {
        if (s.items.some((i) => i.trackId === track.id)) return s // already scheduled
        const item: ShowItem = {
          id: newId('itm'),
          kind: track.role,
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          durationSec: track.durationSec,
          artwork: track.artwork,
        }
        let at = s.items.length
        if (action.atMergedIndex !== undefined) {
          const tl = layoutShow(s.settings, s.items, state.clocks)
          at = mergedToManualIndex(tl.entries, action.atMergedIndex)
        }
        const items = s.items.slice()
        items.splice(at, 0, item)
        return { ...s, items }
      })
    }

    case 'item/addMic':
      return withShow(state, (s) => ({ ...s, items: renumberMics([...s.items, micItem(s.items.filter((i) => i.kind === 'mic').length + 1)]) }))

    case 'item/addStation':
      return withShow(state, (s) => ({
        ...s,
        items: [...s.items, { id: newId('stn'), kind: 'station', title: action.label, artist: 'Station element', album: '', durationSec: action.durationSec, stationKey: action.clockKey }],
      }))

    case 'item/remove':
      return withShow(state, (s) => {
        const target = s.items.find((i) => i.id === action.id)
        if (!target) return s
        return { ...s, items: renumberMics(s.items.filter((i) => i.id !== action.id)) }
      })

    case 'item/removeTrack':
      return withShow(state, (s) => {
        const items = s.items.filter((i) => i.trackId !== action.trackId)
        return items.length === s.items.length ? s : { ...s, items }
      })

    case 'item/update': {
      const patch = action.patch
      // Editing a song's details in the rundown edits its library entry too.
      const item = activeShow(state).items.find((i) => i.id === action.id)
      let library = state.library
      if (item?.trackId && (item.kind === 'required' || item.kind === 'personal')) {
        library = state.library.map((t) => (t.id === item.trackId ? { ...t, ...patch } : t))
      }
      return withShow({ ...state, library }, (s) => ({ ...s, items: s.items.map((i) => (i.id === action.id ? { ...i, ...patch } : i)) }))
    }

    case 'item/reorder':
      return withShow(state, (s) => {
        const tl = layoutShow(s.settings, s.items, state.clocks)
        const merged = tl.entries.map((e) => e.item)
        const from = merged.findIndex((i) => i.id === action.activeId)
        const to = merged.findIndex((i) => i.id === action.overId)
        if (from < 0 || to < 0 || from === to) return s
        return { ...s, items: renumberMics(reorderToStored(merged, from, to)) }
      })

    case 'item/move':
      return withShow(state, (s) => {
        const tl = layoutShow(s.settings, s.items, state.clocks)
        const merged = tl.entries.map((e) => e.item)
        const from = merged.findIndex((i) => i.id === action.id)
        const to = from + action.delta
        if (from < 0 || to < 0 || to >= merged.length) return s
        return { ...s, items: renumberMics(reorderToStored(merged, from, to)) }
      })

    case 'show/clearItems':
      return withShow(state, (s) => (s.items.length ? { ...s, items: [] } : s))

    case 'mics/spread':
      return withShow(state, (s) => ({ ...s, items: renumberMics(spreadMicBreaks(s.items)) }))

    case 'station/unpinAll':
      return withShow(state, (s) => {
        const items = s.items.filter((i) => i.kind !== 'station')
        return items.length === s.items.length ? s : { ...s, items }
      })

    case 'show/new': {
      const show = newShow(state.defaults)
      return { ...state, shows: [show, ...state.shows], activeShowId: show.id }
    }

    case 'show/open':
      return state.shows.some((s) => s.id === action.id) ? { ...state, activeShowId: action.id } : state

    case 'show/duplicate': {
      const src = state.shows.find((s) => s.id === action.id)
      if (!src) return state
      const now = new Date().toISOString()
      const copy: Show = {
        ...src,
        id: newId('show'),
        settings: { ...src.settings, showName: src.settings.showName ? `${src.settings.showName} (copy)` : 'Untitled show (copy)' },
        items: src.items.map((i) => ({ ...i, id: newId('itm') })),
        createdAt: now,
        updatedAt: now,
      }
      return { ...state, shows: [copy, ...state.shows], activeShowId: copy.id }
    }

    case 'show/delete': {
      if (!state.shows.some((s) => s.id === action.id)) return state
      let shows = state.shows.filter((s) => s.id !== action.id)
      if (shows.length === 0) shows = [newShow(state.defaults)]
      const active = shows.some((s) => s.id === state.activeShowId) ? state.activeShowId : shows[0].id
      return { ...state, shows, activeShowId: active }
    }

    case 'show/import': {
      const existing = new Set(state.shows.map((s) => s.id))
      const imported = action.shows.map((s) => (existing.has(s.id) ? { ...s, id: newId('show') } : s))
      // bring along the songs these shows use, without duplicating ones we already have
      const have = new Set(state.library.map((t) => t.id))
      const extra = action.tracks.filter((t) => !have.has(t.id))
      return { ...state, shows: [...imported, ...state.shows], activeShowId: imported[0].id, library: [...state.library, ...extra] }
    }

    case 'integrations/set':
      return { ...state, integrations: { ...state.integrations, ...action.patch } }

    default:
      return state
  }
}

/** A library edit (title, length, required/personal...) flows into the current show's copies. */
function applyTrackChangesToShow(state: AppState, ids: string[]): AppState {
  const changed = new Set(ids)
  return withShow(state, (s) => {
    let touched = false
    const items = s.items.map((i) => {
      if (!i.trackId || !changed.has(i.trackId)) return i
      const t = state.library.find((x) => x.id === i.trackId)
      if (!t) return i
      touched = true
      return { ...i, kind: t.role, title: t.title, artist: t.artist, album: t.album, durationSec: t.durationSec, artwork: t.artwork }
    })
    return touched ? { ...s, items } : s
  })
}

export { arrayMove }
