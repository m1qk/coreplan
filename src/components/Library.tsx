import { useDraggable } from '@dnd-kit/core'
import { useMemo, useState } from 'react'
import { useApp } from '../app-context'
import { CdDisc } from './Art'
import { LIB_PREFIX } from './dnd'
import { ConfirmButton, Cover, Icon, Segmented } from './ui'
import { demoLibrary } from '../lib/demo'
import { fmtDuration } from '../lib/time'
import type { Track } from '../lib/types'

type Filter = 'all' | 'required' | 'personal' | 'free'
const PAGE = 120

export function Library({ className = '' }: { className?: string }) {
  const { state, show, dispatch, setDialog, lookup, startLookup, cancelLookup, missingInfoCount, toast } = useApp()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [playlist, setPlaylist] = useState('all')
  const [limit, setLimit] = useState(PAGE)

  const scheduled = useMemo(() => new Set(show.items.map((i) => i.trackId).filter(Boolean) as string[]), [show.items])
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return state.library.filter((t) => {
      if (playlist !== 'all' && t.playlistId !== playlist) return false
      if (filter === 'required' && t.role !== 'required') return false
      if (filter === 'personal' && t.role !== 'personal') return false
      if (filter === 'free' && scheduled.has(t.id)) return false
      if (needle && !`${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [state.library, q, filter, playlist, scheduled])

  const requiredTotal = state.library.filter((t) => t.role === 'required').length
  const empty = state.library.length === 0
  const selectedPl = state.playlists.find((p) => p.id === playlist)

  return (
    <section aria-labelledby="crate-h" className={`panel flex flex-col ${className}`}>
      <div className="titlebar">
        <h2 id="crate-h">Song crate</h2>
        <span className="mono pr-1 text-sm font-bold" data-testid="crate-count">
          {state.library.length} song{state.library.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => setDialog({ type: 'import' })} data-testid="open-import">
          <Icon name="import" className="h-5 w-5" />
          Import songs
        </button>
        <button type="button" className="btn" onClick={() => setDialog({ type: 'import', tab: 'manual' })}>
          <Icon name="plus" className="h-5 w-5" />
          Add one
        </button>
      </div>

      {lookup.running ? (
        <div className="mt-3 flex items-center gap-3 rounded-[3px] border border-ink bg-violet/15 p-2.5 text-sm" role="status">
          <span className="font-bold">
            Finding lengths and artwork: {lookup.done}/{lookup.total}
          </span>
          <button type="button" className="btn btn-sm ml-auto" onClick={cancelLookup}>
            Stop
          </button>
        </div>
      ) : (
        missingInfoCount > 0 && (
          <button type="button" className="btn btn-sm mt-3" onClick={startLookup} data-testid="lookup">
            <Icon name="search" className="h-4 w-4" />
            Find lengths and artwork for {missingInfoCount} song{missingInfoCount === 1 ? '' : 's'}
          </button>
        )
      )}

      {!empty && (
        <div className="mt-3 grid gap-2">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 opacity-60" />
            <input className="field !pl-10" type="search" value={q} onChange={(e) => (setQ(e.target.value), setLimit(PAGE))} placeholder="Search title, artist or album" aria-label="Search songs" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<Filter>
              label="Filter songs"
              value={filter}
              onChange={(v) => (setFilter(v), setLimit(PAGE))}
              options={[
                { value: 'all', label: 'All' },
                { value: 'required', label: 'Required' },
                { value: 'personal', label: 'My picks' },
                { value: 'free', label: 'Not used' },
              ]}
            />
          </div>
          {state.playlists.length > 0 && (
            <div className="flex items-center gap-2">
              <select className="field !min-h-[40px] flex-1" aria-label="Show songs from playlist" value={playlist} onChange={(e) => (setPlaylist(e.target.value), setLimit(PAGE))}>
                <option value="all">All playlists</option>
                {state.playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {selectedPl && (
                <ConfirmButton
                  label={`Remove playlist ${selectedPl.name} and its songs`}
                  onConfirm={() => {
                    dispatch({ type: 'playlist/remove', id: selectedPl.id })
                    setPlaylist('all')
                    toast(`Removed "${selectedPl.name}".`, 'info')
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}

      <div className="scroll-y -mx-1 mt-3 min-h-0 flex-1 px-1 pb-2 pt-1" data-testid="crate-list">
        {empty ? (
          <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
            <CdDisc className="h-32 w-32" />
            <p className="h-sub text-lg">The crate is empty.</p>
            <p className="hint max-w-[18rem]">Import a playlist or a CSV, paste a tracklist, or try a few made-up songs to see how it works.</p>
            <button
              type="button"
              className="btn btn-hot"
              data-testid="load-demo"
              onClick={() => {
                const d = demoLibrary()
                dispatch({ type: 'library/set', library: [...state.library, ...d.tracks], playlists: [...state.playlists, ...d.playlists] })
                toast('Added 19 made-up songs to play with.')
              }}
            >
              <Icon name="spark" className="h-5 w-5" />
              Try demo songs
            </button>
          </div>
        ) : list.length === 0 ? (
          <p className="px-2 py-8 text-center font-bold">No songs match. Clear the search or filter.</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
            {list.slice(0, limit).map((t) => (
              <TrackCard key={t.id} track={t} inShow={scheduled.has(t.id)} />
            ))}
            {list.length > limit && (
              <li>
                <button type="button" className="btn w-full" onClick={() => setLimit((l) => l + PAGE)}>
                  Show {Math.min(PAGE, list.length - limit)} more ({list.length - limit} hidden)
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
      {!empty && (
        <p className="hint border-t border-[#808080] pt-2" data-testid="crate-footer">
          {requiredTotal} required in crate. Drag a song into the show, or tap its + button.
        </p>
      )}
    </section>
  )
}

function TrackCard({ track: t, inShow }: { track: Track; inShow: boolean }) {
  const { dispatch, setDialog } = useApp()
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `${LIB_PREFIX}${t.id}`, disabled: inShow })
  const req = t.role === 'required'
  return (
    <li
      ref={setNodeRef}
      {...(inShow ? {} : listeners)}
      data-testid="track-card"
      data-title={t.title}
      data-role={t.role}
      data-inshow={inShow}
      className={`hit-pad kind-${t.role} flex items-center gap-2.5 rounded-[3px] border border-ink bg-paper-2 p-2 shadow-[inset_1px_1px_0_#fff,inset_-1px_-1px_0_#808080] transition-[transform,box-shadow,opacity] duration-150 ${inShow ? 'opacity-70' : 'cursor-grab hover:-translate-y-0.5 hover:shadow-[inset_1px_1px_0_#fff,inset_-1px_-1px_0_#808080]'} ${isDragging ? 'opacity-30' : ''}`}
      style={{ touchAction: 'pan-y' }}
    >
      <Cover src={t.artwork} title={t.title} artist={t.artist} className="h-14 w-14" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={`chip kind-${t.role} cursor-pointer hover:brightness-110`}
            title={req ? 'Required playlist song. Click to make it one of your own picks.' : 'Your own pick. Click to mark it as a required playlist song.'}
            aria-label={`${req ? 'Required song' : 'Your pick'}: ${t.title}. Click to switch.`}
            onClick={() => dispatch({ type: 'track/update', id: t.id, patch: { role: req ? 'personal' : 'required' } })}
          >
            {req ? 'REQ' : 'PICK'}
          </button>
          {inShow && <span className="sticker !px-1.5 !py-0 !text-[0.68rem]">In show</span>}
        </div>
        <div className="truncate font-bold leading-tight" title={t.title}>
          {t.title}
        </div>
        <div className="truncate text-[0.82rem] text-[#3c3c3c]" title={`${t.artist}${t.album ? ` · ${t.album}` : ''}`}>
          {t.artist}
          {t.album ? ` · ${t.album}` : ''}
        </div>
        <div className={`mono text-xs font-bold ${t.durationSec ? '' : 'text-[#a3123f]'}`}>{t.durationSec ? fmtDuration(t.durationSec) : 'no length yet'}</div>
      </div>
      <div className="flex shrink-0 flex-col gap-1.5">
        <button type="button" className="btn btn-icon btn-primary" aria-label={`Add ${t.title} to the show`} title={inShow ? 'Already in the show' : 'Add to show'} disabled={inShow} onClick={() => dispatch({ type: 'item/addTrack', trackId: t.id })}>
          <Icon name={inShow ? 'check' : 'plus'} />
        </button>
        <div className="flex gap-1.5">
          <button type="button" className="btn btn-icon !min-h-[34px] !min-w-[34px]" aria-label={`Edit ${t.title}`} onClick={() => setDialog({ type: 'edit', target: { kind: 'track', id: t.id } })}>
            <Icon name="edit" className="h-4 w-4" />
          </button>
          <ConfirmButton className="btn btn-icon !min-h-[34px] !min-w-[34px]" label={`Remove ${t.title} from the crate`} onConfirm={() => dispatch({ type: 'track/remove', id: t.id })}>
            <Icon name="trash" className="h-4 w-4" />
          </ConfirmButton>
        </div>
      </div>
    </li>
  )
}
