import { useRef, useState } from 'react'
import { useApp } from '../app-context'
import { ConfirmButton, DurationInput, Field, Icon, Modal, Segmented } from './ui'
import { ImportDialog } from './ImportDialog'
import { DEFAULT_CLOCKS, cloneClocks, keyFromLabel, sanitizeClockItem } from '../lib/clock'
import { downloadText } from '../lib/download'
import { buildShowFile } from '../lib/storage'
import { fileSafeName } from '../lib/exporters'
import { fmtClockShort, fmtDuration, parseTimeOfDay } from '../lib/time'
import type { ClockItem, ClockPresets, TrackRole } from '../lib/types'

export function Dialogs() {
  const { dialog, setDialog } = useApp()
  if (!dialog) return null
  switch (dialog.type) {
    case 'import':
      return <ImportDialog initialTab={dialog.tab} />
    case 'shows':
      return <ShowsDialog />
    case 'clock':
      return <ClockDialog />
    case 'edit':
      return <EditDialog key={`${dialog.target.kind}-${dialog.target.id}`} target={dialog.target} onClose={() => setDialog(null)} />
  }
}

// ------------------------------------------------------------------ my shows

function ShowsDialog() {
  const { state, dispatch, setDialog, importShowFile, toast } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const close = () => setDialog(null)
  const ordered = [...state.shows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return (
    <Modal title="My shows" onClose={close} tape="var(--color-tang)">
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          data-testid="new-show"
          onClick={() => {
            dispatch({ type: 'show/new' })
            close()
          }}
        >
          <Icon name="plus" className="h-5 w-5" />
          New show
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          <Icon name="folder" className="h-5 w-5" />
          Open a show file
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            downloadText('all-core-shows.core-show.json', JSON.stringify(buildShowFile(state.shows, state.library), null, 2), 'application/json')
            toast('All shows saved to one file.')
          }}
        >
          <Icon name="download" className="h-5 w-5" />
          Save all
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a show file"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) {
              await importShowFile(f)
              close()
            }
          }}
        />
      </div>
      <p className="hint mb-3">Shows save automatically in this browser. Use "Save all" to keep a backup file or move to another computer.</p>
      <ul className="grid gap-2.5" data-testid="shows-list">
        {ordered.map((s) => {
          const active = s.id === state.activeShowId
          const startSec = parseTimeOfDay(s.settings.startTime) ?? 0
          return (
            <li key={s.id} data-active={active} className={`flex flex-wrap items-center gap-2 rounded-[3px] border border-ink p-3 ${active ? 'bg-mustard/50' : 'bg-white'}`}>
              <div className="min-w-[10rem] flex-1">
                <div className="font-bold">{s.settings.showName || 'Untitled show'}</div>
                <div className="hint">
                  {s.settings.djName ? `${s.settings.djName} · ` : ''}
                  {s.settings.date} · {fmtClockShort(startSec)} · {s.items.length} item{s.items.length === 1 ? '' : 's'}
                </div>
              </div>
              {active ? (
                <span className="sticker">Open now</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    dispatch({ type: 'show/open', id: s.id })
                    close()
                  }}
                >
                  Open
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  dispatch({ type: 'show/duplicate', id: s.id })
                  toast('Duplicated. You are now editing the copy.')
                  close()
                }}
              >
                Duplicate
              </button>
              <button
                type="button"
                className="btn btn-sm"
                aria-label={`Save ${s.settings.showName || 'untitled show'} as a file`}
                onClick={() => downloadText(`${fileSafeName(s.settings.showName || 'show')}-${s.settings.date}.core-show.json`, JSON.stringify(buildShowFile([s], state.library), null, 2), 'application/json')}
              >
                <Icon name="download" className="h-4 w-4" />
              </button>
              <ConfirmButton className="btn btn-icon btn-sm" label={`Delete ${s.settings.showName || 'untitled show'}`} onConfirm={() => dispatch({ type: 'show/delete', id: s.id })} />
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}

// ------------------------------------------------------------------ station clock

function ClockDialog() {
  const { state, dispatch, setDialog, toast } = useApp()
  const [draft, setDraft] = useState<ClockPresets>(() => cloneClocks(state.clocks))
  const [which, setWhich] = useState<'even' | 'odd'>('even')
  const list = draft[which]
  const update = (i: number, patch: Partial<ClockItem>) => setDraft((d) => ({ ...d, [which]: d[which].map((c, n) => (n === i ? { ...c, ...patch } : c)) }))
  const add = () =>
    setDraft((d) => {
      let key = 'new-element'
      let n = 2
      while (d[which].some((c) => c.key === key)) key = `new-element-${n++}`
      return { ...d, [which]: [...d[which], { key, label: 'New element', offsetMin: 10, durationSec: 30 }] }
    })
  const save = () => {
    const clean: ClockPresets = {
      even: draft.even.map((c) => sanitizeClockItem({ ...c, key: keyFromLabel(c.label) === c.key ? c.key : c.key })),
      odd: draft.odd.map((c) => sanitizeClockItem(c)),
    }
    dispatch({ type: 'clocks/set', clocks: clean })
    toast('Station clock saved.')
    setDialog(null)
  }
  return (
    <Modal title="Station clock" onClose={() => setDialog(null)} tape="var(--color-pink)">
      <p className="hint mb-3">
        Each element is due at a minute past the hour. The planner puts it in the gap nearest that time, and warns you if it ends up outside your flexibility window. These presets are saved in this browser.
      </p>
      <Segmented<'even' | 'odd'>
        label="Which hour"
        value={which}
        onChange={setWhich}
        options={[
          { value: 'even', label: 'Even hours (2-3, 6-7)' },
          { value: 'odd', label: 'Odd hours (1-2, 7-8)' },
        ]}
      />
      <div className="mt-3 grid gap-2.5" data-testid="clock-list">
        <div className="hidden grid-cols-[1fr_5rem_6rem_2.75rem] gap-2 px-1 text-sm font-bold sm:grid">
          <span>Name</span>
          <span>Minute</span>
          <span>Length</span>
          <span />
        </div>
        {list.map((c, i) => (
          <div key={`${c.key}-${i}`} className="grid grid-cols-[1fr_5rem] items-end gap-2 rounded-[3px] border border-ink bg-white p-2 sm:grid-cols-[1fr_5rem_6rem_2.75rem] sm:items-center sm:border-0 sm:bg-transparent sm:p-0">
            <input className="field" aria-label="Element name" value={c.label} maxLength={60} onChange={(e) => update(i, { label: e.target.value })} />
            <input className="field mono text-center" aria-label={`${c.label} minute past the hour`} type="number" min={0} max={59} value={c.offsetMin} onChange={(e) => update(i, { offsetMin: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })} />
            <DurationInput value={c.durationSec} label={`${c.label} length`} onCommit={(s) => s && update(i, { durationSec: s })} className="!w-full" />
            <ConfirmButton label={`Remove ${c.label}`} onConfirm={() => setDraft((d) => ({ ...d, [which]: d[which].filter((_, n) => n !== i) }))} />
          </div>
        ))}
        {list.length === 0 && <p className="hint">No elements. Add one, or reset to the station preset.</p>}
      </div>
      <p className="hint mt-3">Minute 15 means due at :15 past the hour. Lengths are in m:ss.</p>
      <Note />
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={add}>
          <Icon name="plus" className="h-5 w-5" />
          Add element
        </button>
        <button type="button" className="btn" onClick={() => setDraft(cloneClocks(DEFAULT_CLOCKS))}>
          Reset to preset
        </button>
        <button type="button" className="btn btn-primary ml-auto" onClick={save} data-testid="clock-save">
          Save clock
        </button>
      </div>
    </Modal>
  )
}

function Note() {
  return (
    <div className="mt-3 rounded-[3px] border border-ink bg-mustard/45 p-3 text-sm">
      <b>Please check these against the real clock.</b> The preset follows the station clock diagram: even hours run PHS Partnership, Image ID, Community Calendar, Station Promo and odd hours run PHS Partnership, PSA, Concert Calendar, DJ Promo, one every 15 minutes. The diagram has no minute marks or lengths, so the minutes and lengths here are my assumptions. Change anything that doesn't match what your station actually runs.
    </div>
  )
}

// ------------------------------------------------------------------ edit

function EditDialog({ target, onClose }: { target: { kind: 'track'; id: string } | { kind: 'item'; id: string }; onClose: () => void }) {
  const { state, show, dispatch } = useApp()
  const track = target.kind === 'track' ? state.library.find((t) => t.id === target.id) : undefined
  const item = target.kind === 'item' ? show.items.find((i) => i.id === target.id) : undefined
  const src = track ?? item
  const [title, setTitle] = useState(src?.title ?? '')
  const [artist, setArtist] = useState(src?.artist ?? '')
  const [album, setAlbum] = useState(src?.album ?? '')
  const [dur, setDur] = useState<number | null>(src?.durationSec ?? null)
  const [art, setArt] = useState(track?.artwork ?? '')
  const [role, setRole] = useState<TrackRole>(track?.role ?? 'personal')
  if (!src) return null
  const isTrack = !!track
  const valid = title.trim().length > 0

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    if (track) {
      dispatch({ type: 'track/update', id: track.id, patch: { title: title.trim(), artist: artist.trim() || 'Unknown artist', album: album.trim(), durationSec: dur, artwork: art.trim() ? art.trim() : undefined, role } })
    } else if (item) {
      dispatch({ type: 'item/update', id: item.id, patch: { title: title.trim(), durationSec: dur } })
    }
    onClose()
  }

  return (
    <Modal title={isTrack ? 'Edit song' : item?.kind === 'mic' ? 'Edit mic break' : 'Edit station element'} onClose={onClose} tape="var(--color-mustard)">
      <form onSubmit={save} className="grid gap-3">
        <Field label={isTrack ? 'Song title' : 'Name'} htmlFor="e-title">
          <input id="e-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} autoFocus />
        </Field>
        {isTrack && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Artist" htmlFor="e-artist">
                <input id="e-artist" className="field" value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={300} />
              </Field>
              <Field label="Album" htmlFor="e-album">
                <input id="e-album" className="field" value={album} onChange={(e) => setAlbum(e.target.value)} maxLength={300} />
              </Field>
            </div>
            <Field label="Artwork link (optional)" htmlFor="e-art" hint="An image address starting with https://. Leave empty for a generated cover.">
              <input id="e-art" className="field" value={art} onChange={(e) => setArt(e.target.value)} placeholder="https://..." />
            </Field>
            <div>
              <span className="label">This song is</span>
              <Segmented<TrackRole>
                label="Song type"
                value={role}
                onChange={setRole}
                options={[
                  { value: 'required', label: 'Required playlist (red)' },
                  { value: 'personal', label: 'My pick (blue)' },
                ]}
              />
            </div>
          </>
        )}
        <div>
          <span className="label" id="e-dur-l">
            Length (m:ss)
          </span>
          <DurationInput value={dur} onCommit={setDur} label="Length" allowEmpty={isTrack} />
          {dur ? <span className="mono ml-3 text-sm">{fmtDuration(dur)}</span> : null}
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid} data-testid="edit-save">
            Save changes
          </button>
        </div>
      </form>
    </Modal>
  )
}
