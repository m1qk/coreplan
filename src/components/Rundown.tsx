import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useApp } from '../app-context'
import { MicOrb } from './Art'
import { RUNDOWN_END } from './dnd'
import { ConfirmButton, Cover, DurationInput, DurationStepper, Icon, KindChip, KindIcon, Menu, MenuItem, Segmented } from './ui'
import { KIND_LABEL, timingText } from '../lib/exporters'
import { allClockElements } from '../lib/clock'
import { fmtClock, fmtClockShort, fmtDuration } from '../lib/time'
import type { TimelineEntry } from '../lib/types'

export function Rundown({ className = '' }: { className?: string }) {
  const { show, state, timeline, dispatch, view, setView, toast, validation } = useApp()
  const entries = timeline.entries
  const hasItems = entries.length > 0
  const { setNodeRef, isOver } = useDroppable({ id: RUNDOWN_END })
  const elements = allClockElements(state.clocks)

  return (
    <section aria-labelledby="show-h" className={`panel flex flex-col ${className}`}>
      <div className="titlebar">
        <h2 id="show-h">On the air</h2>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="mono text-sm font-bold" data-testid="onair-range">
            {fmtClockShort(timeline.startSec)} to {fmtClockShort(timeline.startSec + timeline.showDurationSec)}
            {show.settings.showName.trim() ? ` · ${show.settings.showName.trim()}` : ''}
          </p>
        </div>
        <Segmented<'list' | 'timeline'>
          label="Rundown view"
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: 'List' },
            { value: 'timeline', label: 'Timeline' },
          ]}
        />
      </div>

      <Legend />
      <AirStrip />

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm btn-primary" data-testid="add-mic" onClick={() => dispatch({ type: 'item/addMic' })}>
          <Icon name="mic" className="h-4 w-4" />
          Mic break
        </button>
        <Menu label="Station element" icon="radio" className="[&>button]:btn-sm [&>button]:!min-h-[36px] [&>button]:![--b:var(--gloss-gray)]">
          {(close) => (
            <>
              {elements.map((el) => (
                <MenuItem
                  key={el.key}
                  icon="radio"
                  hint={`${fmtDuration(el.durationSec)}. Placed where you leave it.`}
                  onClick={() => {
                    dispatch({ type: 'item/addStation', clockKey: el.key, label: el.label, durationSec: el.durationSec })
                    close()
                  }}
                >
                  {el.label}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!show.items.some((i) => i.kind === 'mic')}
          onClick={() => {
            dispatch({ type: 'mics/spread' })
            toast('Mic breaks spread evenly through the songs.')
          }}
          title="Space the mic breaks evenly through the show"
        >
          <Icon name="spark" className="h-4 w-4" />
          Spread mic breaks
        </button>
        {show.items.some((i) => i.kind === 'station') && (
          <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'station/unpinAll' })} title="Remove placed station elements and let the scheduler place them">
            Let scheduler place all
          </button>
        )}
        <ConfirmButton className="btn btn-sm" label="Clear the whole show" onConfirm={() => dispatch({ type: 'show/clearItems' })}>
          <Icon name="trash" className="h-4 w-4" />
          Clear show
        </ConfirmButton>
      </div>

      <div className="scroll-y -mx-1 mt-3 min-h-0 flex-1 px-1 pb-2 pt-1" data-testid="rundown">
        {!hasItems ? (
          <div ref={setNodeRef} className={`flex flex-col items-center gap-2 rounded-[3px] border-2 border-dashed border-ink/60 px-4 py-8 text-center transition-colors ${isOver ? 'bg-mustard/50' : ''}`}>
            <MicOrb className="h-32 w-32" />
            <p className="h-sub text-lg">Nothing on the air yet.</p>
            <p className="hint max-w-[22rem]">Drag songs here from the crate, or tap + on any song. Station elements will appear on their own as the show fills up.</p>
            {state.library.length === 0 && <p className="hint max-w-[22rem] font-bold">Start by importing songs into the crate.</p>}
          </div>
        ) : view === 'list' ? (
          <>
            <SortableContext items={entries.map((e) => e.item.id)} strategy={verticalListSortingStrategy}>
              <ol className="grid grid-cols-[minmax(0,1fr)] gap-2.5" data-testid="rundown-list">
                {entries.map((e, i) => (
                  <Row key={e.item.id} entry={e} index={i} last={i === entries.length - 1} />
                ))}
              </ol>
            </SortableContext>
            <div ref={setNodeRef} className={`mt-3 rounded-[3px] border-2 border-dashed border-ink/50 px-3 py-3 text-center text-sm font-bold transition-colors ${isOver ? 'bg-mustard/60' : 'opacity-70'}`}>
              Drop here to add to the end
            </div>
          </>
        ) : (
          <TimelineView />
        )}
        {hasItems && validation.remainingSec > 0 && <p className="hint mt-3 text-center">{fmtDuration(validation.remainingSec)} of airtime still open.</p>}
      </div>
    </section>
  )
}

export function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-[0.8rem] font-bold" aria-label="Color key">
      {(['required', 'personal', 'mic', 'station'] as const).map((k) => (
        <li key={k} className={`kind-${k} flex items-center gap-1.5`}>
          <span className="h-4 w-4 rounded border border-ink" style={{ background: 'var(--c)' }} />
          {k === 'required' ? 'Required song' : k === 'personal' ? 'Your pick' : k === 'mic' ? 'Mic break' : 'Station element'}
        </li>
      ))}
    </ul>
  )
}

/** Proportional strip of the whole hour with quarter-hour ticks. */
function AirStrip() {
  const { timeline, focusRow } = useApp()
  const scale = Math.max(timeline.totalSec, timeline.showDurationSec, 1)
  const over = timeline.totalSec > timeline.showDurationSec
  const pct = (sec: number) => `${(sec / scale) * 100}%`
  const ticks = []
  for (let m = 0; m * 60 <= scale; m += 15) ticks.push(m)
  return (
    <div className="mt-2.5" data-testid="airstrip">
      <div className="relative flex h-11 overflow-hidden rounded-[3px] border border-ink bg-[repeating-linear-gradient(45deg,#fff_0_6px,#d6d6d6_6px_12px)]">
        {timeline.entries.map((e) =>
          e.durationSec > 0 ? (
            <button
              key={e.item.id}
              type="button"
              className={`kind-${e.item.kind} h-full border-r-2 border-ink/70 transition-[filter] hover:brightness-110`}
              style={{ width: pct(e.durationSec), background: 'var(--c)', minWidth: 3 }}
              title={`${e.item.title} · ${fmtClock(e.start)} to ${fmtClock(e.end)}`}
              aria-label={`${KIND_LABEL[e.item.kind]}: ${e.item.title}, ${fmtClock(e.start)}`}
              onClick={() => focusRow(e.item.id)}
            />
          ) : null,
        )}
        {over && <div className="pointer-events-none absolute inset-y-0 w-[3px] bg-ink" style={{ left: pct(timeline.showDurationSec) }} title="End of show" />}
      </div>
      <div className="relative mono mt-1 h-4 text-[0.68rem] font-bold text-[#3c3c3c]" aria-hidden="true">
        {ticks.map((m) => (
          <span key={m} className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full" style={{ left: pct(m * 60) }}>
            {fmtClockShort(timeline.startSec + m * 60).replace(':00', '').replace(' ', '')}
          </span>
        ))}
      </div>
    </div>
  )
}

function Row({ entry, index, last }: { entry: TimelineEntry; index: number; last: boolean }) {
  const { dispatch, setDialog } = useApp()
  const { item } = entry
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const isSong = item.kind === 'required' || item.kind === 'personal'
  const auto = !!item.auto
  const timing = timingText(entry)

  return (
    <li
      ref={setNodeRef}
      id={`row-${item.id}`}
      data-testid="row"
      data-kind={item.kind}
      data-title={item.title}
      data-auto={auto || undefined}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined }}
      className={`kind-${item.kind} pop-in grid grid-cols-[5.6rem_minmax(0,1fr)] overflow-hidden rounded-[3px] border border-ink bg-[var(--tint)] shadow-[inset_1px_1px_0_#fff,inset_-1px_-1px_0_#808080] sm:grid-cols-[6.4rem_minmax(0,1fr)] ${isDragging ? 'opacity-40' : ''}`}
    >
      {/* the ticket stub: color + start time + tag, readable without color */}
      <div className="flex flex-col items-center justify-center gap-1 border-r border-dashed border-ink/80 bg-[var(--c)] px-1 py-2 text-white">
        <span className="mono text-[0.95rem] font-bold leading-none" data-testid="row-start">
          {fmtClock(entry.start)}
        </span>
        <span className="rounded bg-white/95 px-1.5 text-[0.68rem] font-bold tracking-wide text-ink">{KIND_LABEL[item.kind].toUpperCase()}</span>
        <span className="mono text-[0.72rem] opacity-90">to {fmtClock(entry.end)}</span>
      </div>

      <div className="min-w-0 p-2">
        <div className="flex items-start gap-2">
          <button ref={setActivatorNodeRef} {...attributes} {...listeners} type="button" className="drag-handle btn btn-icon btn-ghost !min-w-[36px] shrink-0 !px-0" aria-label={`Move ${item.title}. Press space, then use arrow keys.`} title="Drag to reorder">
            <Icon name="grip" className="h-5 w-5" />
          </button>
          {isSong ? <Cover src={item.artwork} title={item.title} artist={item.artist} className="h-12 w-12" /> : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[3px] border border-ink bg-[var(--c)] text-white"><KindIcon kind={item.kind} className="h-6 w-6" /></span>}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <KindChip kind={item.kind} />
              {item.kind === 'station' && <span className="sticker !px-1.5 !py-0 !text-[0.68rem]" style={{ ['--s' as string]: auto ? 'var(--color-mustard)' : 'var(--color-pink)' }}>{auto ? 'Auto' : 'Placed by you'}</span>}
            </div>
            <div className="truncate font-bold leading-tight" title={item.title}>
              {item.title}
            </div>
            {(item.artist || item.album) && (
              <div className="truncate text-[0.82rem] text-[#3c3c3c]">
                {item.artist}
                {item.album ? ` · ${item.album}` : ''}
              </div>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-1">
          {isSong ? (
            <DurationInput value={item.durationSec} label={`${item.title} length`} onCommit={(sec) => dispatch({ type: 'item/update', id: item.id, patch: { durationSec: sec } })} />
          ) : auto ? (
            <span className="mono rounded-[3px] border border-ink bg-white px-2 py-1 text-sm font-bold" title="Lengths for auto-placed elements come from the station clock">
              {fmtDuration(item.durationSec)}
            </span>
          ) : (
            <DurationStepper value={item.durationSec} label={item.title} onChange={(sec) => dispatch({ type: 'item/update', id: item.id, patch: { durationSec: sec } })} />
          )}

          {entry.target && entry.severity && (
            <span
              data-testid="timing"
              data-severity={entry.severity}
              className={`inline-flex items-center gap-1 rounded-full border border-ink px-2 py-0.5 text-[0.78rem] font-bold ${entry.severity === 'ok' ? 'bg-white' : entry.severity === 'warn' ? 'bg-mustard' : 'bg-pink'}`}
              title={`Due ${fmtClock(entry.target.targetSec)}`}
            >
              <Icon name={entry.severity === 'ok' ? 'check' : 'alert'} className="h-3.5 w-3.5" />
              due {fmtClock(entry.target.targetSec)} · {timing}
            </span>
          )}

          <span className="ml-auto flex items-center gap-1">
            <button type="button" className="btn btn-icon btn-sm" aria-label={`Move ${item.title} up`} disabled={index === 0} onClick={() => dispatch({ type: 'item/move', id: item.id, delta: -1 })}>
              <Icon name="up" className="h-4 w-4" />
            </button>
            <button type="button" className="btn btn-icon btn-sm" aria-label={`Move ${item.title} down`} disabled={last} onClick={() => dispatch({ type: 'item/move', id: item.id, delta: 1 })}>
              <Icon name="down" className="h-4 w-4" />
            </button>
            {!auto && (
              <button type="button" className="btn btn-icon btn-sm" aria-label={`Edit ${item.title}`} onClick={() => setDialog({ type: 'edit', target: isSong && item.trackId ? { kind: 'track', id: item.trackId } : { kind: 'item', id: item.id } })}>
                <Icon name="edit" className="h-4 w-4" />
              </button>
            )}
            {!auto && (
              <ConfirmButton className="btn btn-icon btn-sm" label={`Remove ${item.title} from the show`} onConfirm={() => dispatch({ type: 'item/remove', id: item.id })}>
                <Icon name="x" className="h-4 w-4" />
              </ConfirmButton>
            )}
          </span>
        </div>
      </div>
    </li>
  )
}

/** Read-only vertical timeline, block height scales with length. */
function TimelineView() {
  const { timeline, focusRow } = useApp()
  const PX = 0.26
  return (
    <ol className="relative grid grid-cols-[minmax(0,1fr)] gap-1.5 pl-1" data-testid="timeline-view">
      {timeline.entries.map((e) => (
        <li key={e.item.id} className="grid grid-cols-[4.6rem_minmax(0,1fr)] items-stretch gap-2">
          <span className="mono pt-1 text-right text-xs font-bold">{fmtClock(e.start)}</span>
          <button
            type="button"
            onClick={() => focusRow(e.item.id)}
            className={`kind-${e.item.kind} flex items-center gap-2 overflow-hidden rounded-[3px] border border-ink px-2.5 text-left text-white transition-transform hover:-translate-y-0.5`}
            style={{ minHeight: Math.max(36, e.durationSec * PX), background: 'var(--c)' }}
            aria-label={`${KIND_LABEL[e.item.kind]}: ${e.item.title}, ${fmtDuration(e.durationSec)}. Open in list.`}
          >
            <span className="min-w-0 flex-1 truncate font-bold">
              {e.item.title}
              {e.item.artist && e.item.kind !== 'station' && <span className="font-normal opacity-90"> · {e.item.artist}</span>}
            </span>
            <span className="mono shrink-0 text-xs font-bold">{fmtDuration(e.durationSec)}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}
