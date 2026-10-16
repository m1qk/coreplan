import { useApp } from '../app-context'
import { CheckOrb } from './Art'
import { Icon } from './ui'
import { airtimeSummary } from '../lib/validate'

/** The airtime meter. Shown big in the Check panel and small in the sticky bar. */
export function Meter({ compact = false }: { compact?: boolean }) {
  const { validation: v } = useApp()
  const a = airtimeSummary(v)
  const pct = v.showDurationSec > 0 ? Math.min(100, (v.totalSec / v.showDurationSec) * 100) : 0
  const color = a.over ? 'var(--color-pink)' : pct >= 95 ? 'var(--color-stn)' : 'var(--color-mustard)'
  return (
    <div data-testid="meter" aria-label={`${a.scheduled} of ${a.total} scheduled, ${a.tail}`} role="group">
      <div className={`flex items-baseline justify-between gap-2 ${compact ? 'text-sm' : ''}`}>
        <span className={`mono font-bold ${compact ? '' : 'text-[1.7rem] leading-none'}`} data-testid="meter-text">
          {a.scheduled} <span className="opacity-60">/ {a.total}</span>
        </span>
        <span className={`font-bold ${a.over ? 'text-[#a3123f]' : ''}`} data-testid="meter-tail">
          {a.tail}
        </span>
      </div>
      <div className={`relative mt-1.5 overflow-hidden rounded-[3px] border border-[#404040] bg-white shadow-[inset_1px_1px_0_#808080] ${compact ? 'h-4' : 'h-6'}`}>
        <div className={`meter-fill h-full ${a.over ? 'stripes-over' : ''}`} style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      {!compact && (
        <p className="hint mt-1.5">
          {v.requiredCount}/{v.requiredNeeded} required songs · {v.micCount}/{v.micNeeded} mic breaks
        </p>
      )}
    </div>
  )
}

/** Sticky strip for phones and tablets, where the full panel is on another tab. */
export function MiniMeter({ className = '' }: { className?: string }) {
  const { validation: v, setTab } = useApp()
  const errors = v.issues.filter((i) => i.severity === 'error').length
  return (
    <div className={`sticky top-0 z-30 border-y border-[#404040] bg-paper/95 px-3 py-2 shadow-[0_2px_6px_rgba(10,50,110,.25)] backdrop-blur ${className}`}>
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <div className="min-w-0 flex-1">
          <Meter compact />
        </div>
        <button type="button" className="btn btn-sm shrink-0" onClick={() => setTab('check')} aria-label={`${v.issues.length} things to check`}>
          <Icon name={v.ready ? 'check' : 'alert'} className="h-4 w-4" />
          {v.ready ? 'Ready' : `${errors || v.issues.length} to fix`}
        </button>
      </div>
    </div>
  )
}

export function CheckPanel({ className = '' }: { className?: string }) {
  const { validation: v, show, state, timeline, saveStatus, focusRow, setDialog } = useApp()
  const personalCount = timeline.entries.filter((e) => e.item.kind === 'personal').length
  const s = show.settings
  const steps = [
    { done: !!s.showName.trim() && !!s.startTime, label: 'Name your show and set the start time' },
    { done: state.library.length > 0, label: 'Import or add songs' },
    { done: v.requiredCount >= v.requiredNeeded, label: `Add ${v.requiredNeeded} required playlist songs` },
    { done: personalCount > 0, label: 'Add your own picks' },
    { done: v.micCount === v.micNeeded, label: `Place ${v.micNeeded} mic breaks` },
    { done: v.ready, label: 'Clear the checks below' },
    { done: saveStatus.kind === 'saved', label: 'Save or export' },
  ]
  const next = steps.findIndex((x) => !x.done)

  return (
    <section aria-labelledby="check-h" className={`panel ${className}`}>
      <div className="titlebar">
        <h2 id="check-h">Check the hour</h2>
      </div>
      <Meter />

      <div className="mt-4" data-testid="issues">
        {v.issues.length === 0 ? (
          <div className="flex items-center gap-3 rounded-[3px] border border-ink bg-stn-tint p-3">
            <CheckOrb className="h-14 w-14 shrink-0" />
            <p className="font-bold">All clear. This show meets every station requirement.</p>
          </div>
        ) : (
          <ul className="grid gap-2">
            {v.issues.map((i) => (
              <li key={i.id} className={`flex items-start gap-2 rounded-[3px] border border-ink p-2.5 text-[0.93rem] ${i.severity === 'error' ? 'bg-pink/35' : 'bg-mustard/45'}`} data-severity={i.severity}>
                <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0" />
                <span className="flex-1">{i.message}</span>
                {i.itemId && (
                  <button type="button" className="btn btn-sm shrink-0 !min-h-[34px]" onClick={() => focusRow(i.itemId!)}>
                    Show me
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <h3 className="h-sub mb-2 mt-5">Game plan</h3>
      <ol className="grid gap-1.5" data-testid="checklist">
        {steps.map((st, i) => (
          <li key={st.label} className={`flex items-center gap-2.5 px-2 py-1.5 ${i === next ? 'bg-[#cfe6fb] font-bold shadow-[inset_1px_1px_0_#808080,inset_-1px_-1px_0_#fff]' : ''}`} aria-current={i === next ? 'step' : undefined}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-ink text-xs font-bold ${st.done ? 'bg-stn text-white' : 'bg-white'}`}>{st.done ? <Icon name="check" className="h-3.5 w-3.5" /> : i + 1}</span>
            <span className={st.done ? 'line-through decoration-2 opacity-70' : ''}>{st.label}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-sm mt-4" onClick={() => setDialog({ type: 'clock' })}>
        <Icon name="clock" className="h-4 w-4" />
        Review station clock times
      </button>
    </section>
  )
}
