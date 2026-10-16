import { useEffect } from 'react'
import { AppProvider, useApp, type PaneTab } from './app-context'
import { Bubbles } from './components/Art'
import { CheckPanel, MiniMeter } from './components/CheckPanel'
import { Dialogs } from './components/Dialogs'
import { PlannerDnd } from './components/dnd'
import { Header } from './components/Header'
import { Library } from './components/Library'
import { PrintSheet } from './components/PrintSheet'
import { Rundown } from './components/Rundown'
import { SetupPanel } from './components/SetupPanel'
import { Toasts } from './components/Toasts'
import { Icon } from './components/ui'
import { completeLoginIfPresent } from './lib/importers/spotify'

// Finish a Spotify sign-in exactly once, even when React runs effects twice in development.
let spotifyReturn: Promise<Awaited<ReturnType<typeof completeLoginIfPresent>>> | null = null

function SpotifyReturn() {
  const { setDialog, toast } = useApp()
  useEffect(() => {
    if (!window.location.search) return
    spotifyReturn ??= completeLoginIfPresent(window.location.search, window.localStorage).catch(() => ({ ok: false as const, message: "Couldn't finish the Spotify sign-in." }))
    let alive = true
    void spotifyReturn.then((r) => {
      if (!r || !alive) return
      window.history.replaceState({}, '', window.location.pathname + window.location.hash)
      if (r.ok) {
        toast('Spotify connected. Paste a playlist link to import it.')
      } else toast(r.message, 'error')
      setDialog({ type: 'import', tab: 'spotify' })
    })
    return () => {
      alive = false
    }
  }, [setDialog, toast])
  return null
}

const TABS: Array<{ id: PaneTab; label: string; icon: Parameters<typeof Icon>[0]['name'] }> = [
  { id: 'setup', label: 'Setup', icon: 'edit' },
  { id: 'crate', label: 'Crate', icon: 'spark' },
  { id: 'show', label: 'Show', icon: 'radio' },
  { id: 'check', label: 'Check', icon: 'check' },
]

function Planner() {
  const { tab, setTab, validation, show } = useApp()
  const vis = (id: PaneTab) => (tab === id ? 'block' : 'hidden') + ' min-[1100px]:block'
  const problems = validation.issues.filter((i) => i.severity !== 'ok').length

  return (
    <>
      <div className="relative min-h-dvh">
        <Bubbles />
        <div className="relative z-10 flex min-h-dvh flex-col min-[1100px]:h-dvh min-[1100px]:overflow-hidden">
          <Header />
          <MiniMeter className="min-[1100px]:hidden" />
          <PlannerDnd>
            <main className="mx-auto w-full max-w-[1700px] flex-1 px-3 pb-28 pt-4 min-[1100px]:grid min-[1100px]:min-h-0 min-[1100px]:grid-cols-[19.5rem_minmax(20rem,25rem)_minmax(0,1fr)] min-[1100px]:gap-6 min-[1100px]:px-5 min-[1100px]:pb-5 min-[1100px]:pt-3">
              <div className="min-[1100px]:scroll-y min-[1100px]:min-h-0 min-[1100px]:pb-2 min-[1100px]:pr-2">
                <div className={`${vis('setup')}`}>
                  <SetupPanel />
                </div>
                <div className={`${vis('check')} min-[1100px]:mt-6`}>
                  <CheckPanel />
                </div>
              </div>
              <div className={`${vis('crate')} min-[1100px]:min-h-0 min-[1100px]:pb-2 min-[1100px]:pr-2`}>
                <Library className="min-[1100px]:h-full" />
              </div>
              <div className={`${vis('show')} min-[1100px]:min-h-0 min-[1100px]:pb-2 min-[1100px]:pr-2`}>
                <Rundown className="min-[1100px]:h-full" />
              </div>
            </main>
          </PlannerDnd>
        </div>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-white bg-paper pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_#808080,0_-6px_14px_rgba(10,50,110,.25)] min-[1100px]:hidden" aria-label="Sections">
          <div className="mx-auto grid max-w-xl grid-cols-4">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                data-testid={`nav-${t.id}`}
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => {
                  setTab(t.id)
                  window.scrollTo({ top: 0 })
                }}
                className={`relative flex min-h-[3.4rem] flex-col items-center justify-center gap-0.5 border-r border-[#808080] text-[0.78rem] font-bold last:border-r-0 ${tab === t.id ? 'bg-[#cfe6fb] shadow-[inset_1px_2px_3px_rgba(0,40,100,.45)]' : 'bg-transparent'}`}
              >
                <Icon name={t.icon} className="h-5 w-5" />
                {t.label}
                {t.id === 'check' && problems > 0 && <span className="absolute right-[22%] top-1.5 rounded-full border-2 border-ink bg-pink px-1.5 text-[0.65rem] leading-4">{problems}</span>}
                {t.id === 'show' && show.items.length > 0 && <span className="absolute right-[22%] top-1.5 rounded-full border-2 border-ink bg-paper px-1.5 text-[0.65rem] leading-4">{show.items.length}</span>}
              </button>
            ))}
          </div>
        </nav>

        <Dialogs />
        <Toasts />
        <SpotifyReturn />
      </div>
      <PrintSheet />
    </>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Planner />
    </AppProvider>
  )
}
