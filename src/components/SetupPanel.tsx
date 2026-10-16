import { useApp } from '../app-context'
import { Field, Icon, Segmented } from './ui'
import { parityForHour } from '../lib/scheduler'
import { parseTimeOfDay } from '../lib/time'
import type { ClockMode, FlexMinutes } from '../lib/types'

const LENGTHS = [30, 45, 60, 90, 120]

export function SetupPanel({ className = '' }: { className?: string }) {
  const { show, state, dispatch, setDialog, toast } = useApp()
  const s = show.settings
  const set = (patch: Partial<typeof s>) => dispatch({ type: 'settings/update', patch })
  const startSec = parseTimeOfDay(s.startTime) ?? 0
  const parity = parityForHour(Math.floor(startSec / 3600), s.clockMode)
  const lengths = LENGTHS.includes(s.durationMin) ? LENGTHS : [...LENGTHS, s.durationMin].sort((a, b) => a - b)

  return (
    <section aria-labelledby="setup-h" className={`panel ${className}`}>
      <div className="titlebar">
        <h2 id="setup-h">Show details</h2>
      </div>
      <div className="grid gap-3">
        <Field label="Show name" htmlFor="f-show">
          <input id="f-show" className="field" value={s.showName} maxLength={120} placeholder="Required: enter your show name" onChange={(e) => set({ showName: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="DJ name" htmlFor="f-dj">
          <input id="f-dj" className="field" value={s.djName} maxLength={120} placeholder="Required: enter your DJ name" onChange={(e) => set({ djName: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Date" htmlFor="f-date">
          <input id="f-date" type="date" className="field" value={s.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
        </Field>
        <div className="grid gap-3">
          <Field label="Start time" htmlFor="f-start">
            <input id="f-start" type="time" className="field mono" value={s.startTime} onChange={(e) => e.target.value && set({ startTime: e.target.value })} />
          </Field>
          <Field label="Show length" htmlFor="f-len">
            <select id="f-len" className="field" value={s.durationMin} onChange={(e) => set({ durationMin: Number(e.target.value) })}>
              {lengths.map((m) => (
                <option key={m} value={m}>
                  {m === 60 ? '60 minutes (standard hour)' : `${m} minutes`}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <span className="label" id="clock-l">
            Station clock
          </span>
          <Segmented<ClockMode>
            label="Station clock"
            value={s.clockMode}
            onChange={(v) => set({ clockMode: v })}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'even', label: 'Even hour' },
              { value: 'odd', label: 'Odd hour' },
            ]}
          />
          <p className="hint mt-1">
            {s.clockMode === 'auto' ? `Following the hour you start in: using the ${parity} hour clock.` : `Always using the ${parity} hour clock.`}
          </p>
        </div>

        <div>
          <span className="label">Announcement flexibility (minutes)</span>
          <Segmented<FlexMinutes>
            label="Announcement flexibility"
            value={s.flexMin}
            onChange={(v) => set({ flexMin: v })}
            options={([1, 2, 3, 5] as const).map((m) => ({ value: m, label: `±${m}`, title: `Station elements may land up to ${m} minute${m > 1 ? 's' : ''} from their due time` }))}
          />
          <p className="hint mt-1">Elements are due about every 15 minutes. They go in the nearest gap between songs, never in the middle of one.</p>
        </div>

        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[3px] border border-ink bg-white px-3 py-2 font-bold">
          <input type="checkbox" className="h-5 w-5 accent-violet" checked={s.autoPlace} onChange={(e) => set({ autoPlace: e.target.checked })} />
          Place station elements for me
        </label>

        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className="btn btn-sm" onClick={() => setDialog({ type: 'clock' })}>
            <Icon name="clock" className="h-4 w-4" />
            Station clock
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              dispatch({ type: 'settings/saveDefaults' })
              toast('Saved. New shows will start with these settings.')
            }}
            title={`Defaults now: ${state.defaults.djName || 'no DJ name'}, ${state.defaults.startTime}, ±${state.defaults.flexMin} min`}
          >
            <Icon name="save" className="h-4 w-4" />
            Use for new shows
          </button>
        </div>
      </div>
    </section>
  )
}
