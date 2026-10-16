import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type Dispatch, type ReactNode } from 'react'
import { layoutShow } from './lib/scheduler'
import { validateShow } from './lib/validate'
import { loadState, parseShowFile, saveState, ShowFileError, type AppState } from './lib/storage'
import { activeShow, initialState, reducer, type Action } from './lib/store'
import { lookupSong } from './lib/importers/itunes'
import { ImportError } from './lib/importers/common'
import { readFileText } from './lib/download'
import type { Show, Timeline, Validation } from './lib/types'

export type DialogState =
  | null
  | { type: 'import'; tab?: 'spotify' | 'apple' | 'csv' | 'paste' | 'manual' }
  | { type: 'shows' }
  | { type: 'clock' }
  | { type: 'edit'; target: { kind: 'track'; id: string } | { kind: 'item'; id: string } }

export type ToastKind = 'ok' | 'error' | 'info'
export interface ToastMsg {
  id: number
  kind: ToastKind
  text: string
}

export type SaveStatus = { kind: 'saved'; at: number } | { kind: 'saving' } | { kind: 'error'; message: string }

export interface LookupState {
  running: boolean
  done: number
  total: number
  filled: number
}

export type PaneTab = 'setup' | 'crate' | 'show' | 'check'

interface Ctx {
  state: AppState
  dispatch: Dispatch<Action>
  show: Show
  timeline: Timeline
  validation: Validation
  toasts: ToastMsg[]
  toast: (text: string, kind?: ToastKind) => void
  dismissToast: (id: number) => void
  saveStatus: SaveStatus
  dialog: DialogState
  setDialog: (d: DialogState) => void
  tab: PaneTab
  setTab: (t: PaneTab) => void
  lookup: LookupState
  startLookup: () => void
  cancelLookup: () => void
  missingInfoCount: number
  importShowFile: (file: File) => Promise<void>
  /** Scroll to a rundown row and flash it. */
  focusRow: (itemId: string) => void
  view: 'list' | 'timeline'
  setView: (v: 'list' | 'timeline') => void
}

const AppCtx = createContext<Ctx | null>(null)

export function useApp(): Ctx {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp must be used inside <AppProvider>')
  return c
}

function readInitial(): AppState {
  try {
    return loadState(window.localStorage) ?? initialState()
  } catch {
    return initialState()
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, readInitial)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [tab, setTab] = useState<PaneTab>('crate')
  const [view, setView] = useState<'list' | 'timeline'>('list')
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: 'saved', at: Date.now() })
  const toastId = useRef(0)

  const show = activeShow(state)
  const timeline = useMemo(() => layoutShow(show.settings, show.items, state.clocks), [show.settings, show.items, state.clocks])
  const validation = useMemo(() => validateShow(show.settings, timeline), [show.settings, timeline])

  // ---- toasts
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const toast = useCallback(
    (text: string, kind: ToastKind = 'ok') => {
      const id = ++toastId.current
      setToasts((t) => [...t.slice(-3), { id, kind, text }])
      window.setTimeout(() => dismissToast(id), kind === 'error' ? 8000 : 4200)
    },
    [dismissToast],
  )

  // ---- autosave (debounced; also flushed when the page is hidden)
  const latest = useRef(state)
  latest.current = state
  const first = useRef(true)
  const flush = useCallback(() => {
    const r = saveState(window.localStorage, latest.current)
    setSaveStatus(r.ok ? { kind: 'saved', at: Date.now() } : { kind: 'error', message: r.message })
  }, [])
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setSaveStatus((s) => (s.kind === 'error' ? s : { kind: 'saving' }))
    const t = window.setTimeout(flush, 250)
    return () => window.clearTimeout(t)
  }, [state, flush])
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [flush])

  // ---- background lookups of lengths and artwork (public iTunes Search API)
  const [lookup, setLookup] = useState<LookupState>({ running: false, done: 0, total: 0, filled: 0 })
  const abortRef = useRef<AbortController | null>(null)
  const missing = useMemo(() => state.library.filter((t) => !t.durationSec || !t.artwork), [state.library])
  const startLookup = useCallback(() => {
    if (abortRef.current) return
    const targets = latest.current.library.filter((t) => !t.durationSec || !t.artwork).map((t) => ({ id: t.id, title: t.title, artist: t.artist }))
    if (targets.length === 0) return
    const ac = new AbortController()
    abortRef.current = ac
    setLookup({ running: true, done: 0, total: targets.length, filled: 0 })
    void (async () => {
      let filled = 0
      let failure: string | null = null
      for (let i = 0; i < targets.length && !ac.signal.aborted; i++) {
        const t = targets[i]
        try {
          const m = await lookupSong(t.title, t.artist, fetch, ac.signal)
          if (m) {
            const cur = latest.current.library.find((x) => x.id === t.id)
            if (cur) {
              const patch: { durationSec?: number | null; artwork?: string; album?: string } = {}
              if (!cur.durationSec && m.durationSec) patch.durationSec = m.durationSec
              if (!cur.artwork && m.artwork) patch.artwork = m.artwork
              if (!cur.album && m.album) patch.album = m.album
              if (Object.keys(patch).length) {
                dispatch({ type: 'track/update', id: t.id, patch })
                filled++
              }
            }
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') break
          failure = e instanceof ImportError ? e.message : "The song lookup didn't work."
          break
        }
        setLookup({ running: true, done: i + 1, total: targets.length, filled })
        if (i < targets.length - 1) await new Promise((r) => window.setTimeout(r, 3100))
      }
      abortRef.current = null
      setLookup({ running: false, done: 0, total: 0, filled: 0 })
      if (failure) toast(failure, 'error')
      else if (ac.signal.aborted) toast(`Stopped. Filled in ${filled} song${filled === 1 ? '' : 's'} so far.`, 'info')
      else toast(filled > 0 ? `Filled in details for ${filled} song${filled === 1 ? '' : 's'}.` : "Couldn't find matches for those songs. Type their lengths in by hand.", filled > 0 ? 'ok' : 'info')
    })()
  }, [toast])
  const cancelLookup = useCallback(() => abortRef.current?.abort(), [])

  // ---- show files
  const importShowFile = useCallback(
    async (file: File) => {
      try {
        const text = await readFileText(file)
        const { shows, tracks } = parseShowFile(text, latest.current.defaults)
        dispatch({ type: 'show/import', shows, tracks })
        toast(`Opened ${shows.length === 1 ? `"${shows[0].settings.showName || 'Untitled show'}"` : `${shows.length} shows`} from the file.`)
      } catch (e) {
        toast(e instanceof ShowFileError ? e.message : "Couldn't read that file.", 'error')
      }
    },
    [toast],
  )

  const focusRow = useCallback((itemId: string) => {
    setTab('show')
    setView('list')
    window.setTimeout(() => {
      const el = document.getElementById(`row-${itemId}`)
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.classList.remove('flash')
      void el.offsetWidth
      el.classList.add('flash')
    }, 60)
  }, [])

  const value: Ctx = {
    state,
    dispatch,
    show,
    timeline,
    validation,
    toasts,
    toast,
    dismissToast,
    saveStatus,
    dialog,
    setDialog,
    tab,
    setTab,
    lookup,
    startLookup,
    cancelLookup,
    missingInfoCount: missing.length,
    importShowFile,
    focusRow,
    view,
    setView,
  }
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
