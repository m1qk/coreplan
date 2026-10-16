import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../app-context'
import { Field, Icon, Modal, Segmented } from './ui'
import { csvTemplate, parseTracklist, parseTracksCsv, safeArtworkUrl, type ImportResult, type ParsedTrack, type RowProblem, type TracklistOrder } from '../lib/csv'
import { mergeTracks } from '../lib/library'
import { downloadText, readFileText } from '../lib/download'
import { fmtDuration, parseDuration } from '../lib/time'
import { ImportError } from '../lib/importers/common'
import { buildAuthorizeUrl, disconnectSpotify, fetchSpotifyPlaylist, getStoredToken, parseSpotifyPlaylistId, spotifyLinkKind, validRedirectUri } from '../lib/importers/spotify'
import { fetchApplePlaylist, inspectDeveloperToken, isApplePrivateLibraryLink, parseApplePlaylistUrl } from '../lib/importers/apple'
import { lookupSong } from '../lib/importers/itunes'
import type { TrackRole, TrackSource } from '../lib/types'

type Tab = 'spotify' | 'apple' | 'csv' | 'paste' | 'manual'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'spotify', label: 'Spotify' },
  { id: 'apple', label: 'Apple Music' },
  { id: 'csv', label: 'CSV file' },
  { id: 'paste', label: 'Paste a list' },
  { id: 'manual', label: 'Add one' },
]

export function ImportDialog({ initialTab }: { initialTab?: Tab }) {
  const { state, dispatch, setDialog, toast, startLookup } = useApp()
  const [tab, setTab] = useState<Tab>(initialTab ?? 'spotify')
  const requiredInCrate = state.library.filter((t) => t.role === 'required').length
  const [role, setRole] = useState<TrackRole>(requiredInCrate < 6 ? 'required' : 'personal')
  const close = () => setDialog(null)

  /** Add songs to the crate, then report what happened. */
  const commit = (tracks: ParsedTrack[], source: TrackSource, playlistName: string | undefined, opts: { lookup?: boolean; keepOpen?: boolean } = {}): boolean => {
    if (tracks.length === 0) {
      toast('There were no songs to import.', 'error')
      return false
    }
    const r = mergeTracks(state.library, state.playlists, tracks, source, playlistName)
    dispatch({ type: 'library/set', library: r.library, playlists: r.playlists })
    const dup = r.duplicates ? ` ${r.duplicates} already in your crate.` : ''
    toast(r.added === 0 ? `Nothing new to add.${dup}` : `Added ${r.added} song${r.added === 1 ? '' : 's'}.${dup}`, r.added === 0 ? 'info' : 'ok')
    if (opts.lookup && r.added > 0) window.setTimeout(startLookup, 120)
    if (!opts.keepOpen) close()
    return true
  }
  const withRole = (list: ParsedTrack[]) => list.map((t) => ({ ...t, role }))

  return (
    <Modal title="Import songs" onClose={close} size="lg" tape="var(--color-mustard)">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[3px] border border-ink bg-white p-3">
        <span className="font-bold">These songs are</span>
        <Segmented<TrackRole>
          label="Song type"
          value={role}
          onChange={setRole}
          options={[
            { value: 'required', label: 'Required playlist (red)' },
            { value: 'personal', label: 'My picks (blue)' },
          ]}
        />
        <span className="hint basis-full">You can switch any song later with the red or blue tag on its card.</span>
      </div>

      <div role="tablist" aria-label="Where are your songs?" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} data-testid={`tab-${t.id}`} onClick={() => setTab(t.id)} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : ''}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'spotify' && <SpotifyTab role={role} commit={commit} withRole={withRole} />}
        {tab === 'apple' && <AppleTab commit={commit} withRole={withRole} />}
        {tab === 'csv' && <CsvTab role={role} commit={commit} />}
        {tab === 'paste' && <PasteTab role={role} commit={commit} />}
        {tab === 'manual' && <ManualTab role={role} commit={commit} />}
      </div>
    </Modal>
  )
}

type Commit = (tracks: ParsedTrack[], source: TrackSource, playlistName: string | undefined, opts?: { lookup?: boolean; keepOpen?: boolean }) => boolean

// ------------------------------------------------------------------ shared bits

function Problems({ problems }: { problems: RowProblem[] }) {
  if (problems.length === 0) return null
  const shown = problems.slice(0, 8)
  return (
    <ul className="mt-2 grid gap-1 text-sm" data-testid="import-problems">
      {shown.map((p, i) => (
        <li key={i} className={`rounded-[3px] border-2 border-ink px-2 py-1 ${p.severity === 'error' ? 'bg-pink/40' : 'bg-mustard/40'}`}>
          <b>Line {p.row}:</b> {p.message}
        </li>
      ))}
      {problems.length > shown.length && <li className="hint">...and {problems.length - shown.length} more.</li>}
    </ul>
  )
}

function Preview({ result }: { result: ImportResult }) {
  if (result.rowsRead === 0 && result.tracks.length === 0) return <Problems problems={result.problems} />
  return (
    <div className="mt-3 rounded-[3px] border border-ink bg-white p-3" data-testid="import-preview">
      <p className="font-bold">
        {result.tracks.length} song{result.tracks.length === 1 ? '' : 's'} ready to import
        {result.problems.length > 0 && <span className="font-normal"> ({result.problems.length} note{result.problems.length === 1 ? '' : 's'} below)</span>}
      </p>
      <ul className="mt-1 grid gap-0.5 text-sm">
        {result.tracks.slice(0, 5).map((t, i) => (
          <li key={i} className="truncate">
            {t.artist} - {t.title} <span className="mono opacity-70">{t.durationSec ? fmtDuration(t.durationSec) : 'no length'}</span>
          </li>
        ))}
        {result.tracks.length > 5 && <li className="hint">...and {result.tracks.length - 5} more</li>}
      </ul>
      <Problems problems={result.problems} />
    </div>
  )
}

function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return <div className={`mt-3 rounded-[3px] border border-ink p-3 text-sm ${tone === 'warn' ? 'bg-mustard/45' : 'bg-violet/10'}`}>{children}</div>
}

function Busy({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <span className="spin-slow inline-block h-4 w-4 rounded-full border border-ink border-t-transparent" style={{ animationDuration: '0.8s' }} />
      {children}
    </span>
  )
}

// ------------------------------------------------------------------ Spotify

function SpotifyTab({ role: _role, commit, withRole }: { role: TrackRole; commit: Commit; withRole: (l: ParsedTrack[]) => ParsedTrack[] }) {
  const { state, dispatch } = useApp()
  const clientId = state.integrations.spotifyClientId
  const redirect = `${window.location.origin}${window.location.pathname}`
  const redirectProblem = validRedirectUri(redirect)
  const [token, setToken] = useState(() => getStoredToken(window.localStorage))
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const connect = async () => {
    setError(null)
    try {
      const url = await buildAuthorizeUrl(clientId.trim(), redirect, window.localStorage)
      window.location.assign(url)
    } catch {
      setError("Couldn't start the Spotify sign-in. This page must be opened over https (or http://127.0.0.1) for secure sign-in to work.")
    }
  }

  const doImport = async () => {
    setError(null)
    const kind = spotifyLinkKind(link)
    const id = parseSpotifyPlaylistId(link)
    if (!id) {
      setError(kind === 'album' || kind === 'track' ? `That is a Spotify ${kind} link. Paste a playlist link (open.spotify.com/playlist/...).` : 'Paste a Spotify playlist link, like https://open.spotify.com/playlist/...')
      return
    }
    const t = getStoredToken(window.localStorage)
    if (!t) {
      setToken(null)
      setError('Your Spotify sign-in has expired. Connect again.')
      return
    }
    setBusy(true)
    setProgress(0)
    try {
      const pl = await fetchSpotifyPlaylist(id, t.accessToken, fetch, setProgress)
      if (pl.tracks.length === 0) setError('That playlist has no songs Spotify would share (podcast episodes and local files are skipped).')
      else {
        commit(withRole(pl.tracks), 'spotify', pl.name)
        return
      }
    } catch (e) {
      setError(e instanceof ImportError ? e.message : 'Something went wrong talking to Spotify.')
      if (e instanceof ImportError && e.code === 'auth-expired') setToken(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h3 className="h-sub mb-2">Import a Spotify playlist</h3>
      <Note tone="warn">
        <b>Heads up.</b> Spotify only lets an app read the songs in playlists <b>you own or collaborate on</b>, and the app has to be set up once in Spotify's developer dashboard. Setup takes about five minutes (see the README, "Spotify setup"). If this feels like too much, use the <b>CSV</b> or <b>Paste a list</b> tab instead.
      </Note>

      <div className="mt-4 grid gap-3">
        <Field label="Your Spotify Client ID" htmlFor="sp-id" hint="From your app's page on developer.spotify.com. It is not a secret and no password or client secret is ever needed here.">
          <input id="sp-id" className="field mono" value={clientId} onChange={(e) => dispatch({ type: 'integrations/set', patch: { spotifyClientId: e.target.value.trim() } })} placeholder="32 character ID" autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Redirect URI to register in the Spotify dashboard" htmlFor="sp-redirect" hint="Paste this exactly into your Spotify app's Redirect URIs.">
          <div className="flex gap-2">
            <input id="sp-redirect" readOnly className="field mono !text-sm" value={redirect} onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="btn btn-sm shrink-0"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(redirect)
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1800)
                } catch {
                  /* the field is selectable as a fallback */
                }
              }}
            >
              <Icon name={copied ? 'check' : 'link'} className="h-4 w-4" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {redirectProblem && <p className="mt-1 text-sm font-bold text-[#a3123f]">{redirectProblem}</p>}
        </Field>

        {token ? (
          <div className="grid gap-3 rounded-[3px] border border-ink bg-stn-tint p-3">
            <p className="flex items-center gap-2 font-bold">
              <Icon name="check" className="h-5 w-5" /> Connected to Spotify
              <button
                type="button"
                className="btn btn-sm ml-auto"
                onClick={() => {
                  disconnectSpotify(window.localStorage)
                  setToken(null)
                }}
              >
                Disconnect
              </button>
            </p>
            <Field label="Playlist link" htmlFor="sp-link">
              <input id="sp-link" className="field" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://open.spotify.com/playlist/..." autoComplete="off" onKeyDown={(e) => e.key === 'Enter' && !busy && void doImport()} />
            </Field>
            <button type="button" className="btn btn-primary w-fit" disabled={busy || !link.trim()} onClick={() => void doImport()} data-testid="spotify-import">
              {busy ? <Busy>Importing {progress ? `${progress} songs...` : '...'}</Busy> : 'Import playlist'}
            </button>
          </div>
        ) : (
          <div>
            <button type="button" className="btn btn-primary" disabled={!clientId.trim() || !!redirectProblem} onClick={() => void connect()} data-testid="spotify-connect">
              Connect Spotify
            </button>
            {!clientId.trim() && <p className="hint mt-1">Enter your Client ID first.</p>}
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-[3px] border border-ink bg-pink/40 p-3 font-bold" data-testid="import-error">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Apple Music

function AppleTab({ commit, withRole }: { commit: Commit; withRole: (l: ParsedTrack[]) => ParsedTrack[] }) {
  const { state, dispatch } = useApp()
  const token = state.integrations.appleToken
  const info = useMemo(() => (token.trim() ? inspectDeveloperToken(token) : null), [token])
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doImport = async () => {
    setError(null)
    if (isApplePrivateLibraryLink(link)) {
      setError('That is a private library link. In the Music app, open the playlist, choose Share, then Copy Link, and make sure it is shared publicly. Public links contain "/playlist/" and an ID starting "pl."')
      return
    }
    const ref = parseApplePlaylistUrl(link)
    if (!ref) return setError('Paste an Apple Music playlist link, like https://music.apple.com/us/playlist/...')
    if (!token.trim() || (info && !info.ok)) return setError(info?.problem ?? 'Paste your developer token first.')
    setBusy(true)
    try {
      const pl = await fetchApplePlaylist(ref, token)
      if (pl.tracks.length === 0) setError('That playlist has no songs Apple would share.')
      else {
        commit(withRole(pl.tracks), 'apple', pl.name)
        return
      }
    } catch (e) {
      setError(e instanceof ImportError ? e.message : 'Something went wrong talking to Apple Music.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h3 className="h-sub mb-2">Import an Apple Music playlist</h3>
      <Note tone="warn">
        <b>Heads up.</b> Apple requires a signed <b>developer token</b>, which needs a paid Apple Developer Program membership. This tool reads <b>publicly shared</b> playlists (the share link contains "/playlist/" and an ID like "pl.u-...") and cannot read private library playlists. No membership? Use the <b>CSV</b> or <b>Paste a list</b> tab and the planner will look up lengths and artwork for you.
      </Note>
      <div className="mt-4 grid gap-3">
        <Field label="Developer token" htmlFor="ap-token" hint='Create one on your own computer with "npm run apple-token" (README, "Apple Music setup"). The private key never goes in this website.'>
          <textarea id="ap-token" className="field !min-h-[5rem]" value={token} onChange={(e) => dispatch({ type: 'integrations/set', patch: { appleToken: e.target.value.trim() } })} placeholder="eyJhbGciOiJFUzI1NiIs..." spellCheck={false} autoComplete="off" />
          {info && (
            <p className={`mt-1 text-sm font-bold ${info.ok ? '' : 'text-[#a3123f]'}`}>
              {info.ok ? (info.expiresAt ? `Token looks valid. Expires ${new Date(info.expiresAt).toLocaleDateString()}.` : 'Token looks valid.') : info.problem}
            </p>
          )}
        </Field>
        <Field label="Playlist link" htmlFor="ap-link">
          <input id="ap-link" className="field" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://music.apple.com/us/playlist/..." autoComplete="off" onKeyDown={(e) => e.key === 'Enter' && !busy && void doImport()} />
        </Field>
        <button type="button" className="btn btn-primary w-fit" disabled={busy || !link.trim()} onClick={() => void doImport()} data-testid="apple-import">
          {busy ? <Busy>Importing...</Busy> : 'Import playlist'}
        </button>
        {error && (
          <p role="alert" className="rounded-[3px] border border-ink bg-pink/40 p-3 font-bold" data-testid="import-error">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ CSV

function CsvTab({ role, commit }: { role: TrackRole; commit: Commit }) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [lookup, setLookup] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const result = useMemo(() => (text.trim() ? parseTracksCsv(text, role) : null), [text, role])

  const load = async (file: File | undefined) => {
    if (!file) return
    setFileError(null)
    if (file.size > 10_000_000) return setFileError('That file is over 10 MB. Split it into smaller files.')
    try {
      setText(await readFileText(file))
      setFileName(file.name)
    } catch {
      setFileError("Couldn't read that file.")
    }
  }

  return (
    <div>
      <h3 className="h-sub mb-2">Import a CSV file</h3>
      <p className="hint">Needs a title column, and artist, album and duration columns help. Spotify exports from tools like Exportify work as they are. Durations can be 3:45, seconds, or milliseconds.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm" onClick={() => downloadText('core-songs-template.csv', csvTemplate(), 'text/csv')}>
          <Icon name="download" className="h-4 w-4" />
          Download example template
        </button>
      </div>
      <label
        className={`mt-3 flex min-h-[7rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-[3px] border-2 border-dashed border-ink p-4 text-center transition-colors ${dragOver ? 'bg-mustard/60' : 'bg-white'}`}
        onDragOver={(e) => (e.preventDefault(), setDragOver(true))}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void load(e.dataTransfer.files?.[0])
        }}
      >
        <Icon name="import" className="h-7 w-7" />
        <span className="font-bold">{fileName || 'Choose a CSV file, or drop it here'}</span>
        <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" data-testid="csv-file" onChange={(e) => void load(e.target.files?.[0])} />
      </label>
      {fileError && <p role="alert" className="mt-2 font-bold text-[#a3123f]">{fileError}</p>}
      <Field label="...or paste CSV text" htmlFor="csv-text">
        <textarea id="csv-text" className="field mt-1" value={text} onChange={(e) => (setText(e.target.value), setFileName(''))} placeholder={'title,artist,album,duration\nNeon Parking Lot,Velvet Static,Midnight Laundromat,3:42'} spellCheck={false} data-testid="csv-text" />
      </Field>
      {result && <Preview result={result} />}
      <LookupToggle checked={lookup} onChange={setLookup} />
      <button
        type="button"
        className="btn btn-primary mt-4"
        disabled={!result || result.tracks.length === 0}
        data-testid="csv-import"
        onClick={() => result && commit(result.tracks, 'csv', fileName.replace(/\.[^.]+$/, '') || 'CSV import', { lookup })}
      >
        Import {result?.tracks.length ?? 0} song{result?.tracks.length === 1 ? '' : 's'}
      </button>
    </div>
  )
}

function LookupToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-[3px] border border-ink bg-white p-3">
      <input type="checkbox" className="mt-0.5 h-5 w-5 accent-violet" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b>Fill in missing lengths and artwork afterward</b>
        <span className="hint block">Looks each song up on Apple's public search (about 20 songs a minute). Anything it can't find stays blank for you to type in.</span>
      </span>
    </label>
  )
}

// ------------------------------------------------------------------ paste

function PasteTab({ role, commit }: { role: TrackRole; commit: Commit }) {
  const [text, setText] = useState('')
  const [order, setOrder] = useState<TracklistOrder>('artist-title')
  const [lookup, setLookup] = useState(true)
  const result = useMemo(() => (text.trim() ? parseTracklist(text, order, role) : null), [text, order, role])
  return (
    <div>
      <h3 className="h-sub mb-2">Paste a tracklist</h3>
      <p className="hint">One song per line. Numbering and a length at the end (3:45) are fine.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="font-bold">Lines look like</span>
        <Segmented<TracklistOrder>
          label="Line format"
          value={order}
          onChange={setOrder}
          options={[
            { value: 'artist-title', label: 'Artist - Title' },
            { value: 'title-artist', label: 'Title - Artist' },
          ]}
        />
      </div>
      <textarea className="field mt-3 !min-h-[10rem]" aria-label="Tracklist" value={text} onChange={(e) => setText(e.target.value)} placeholder={'Velvet Static - Neon Parking Lot (3:42)\nThe Paper Moons - Boombox Heart\nCassette Safari - Tiger in the Tape Deck'} spellCheck={false} data-testid="paste-text" />
      {result && <Preview result={result} />}
      <LookupToggle checked={lookup} onChange={setLookup} />
      <button type="button" className="btn btn-primary mt-4" disabled={!result || result.tracks.length === 0} data-testid="paste-import" onClick={() => result && commit(result.tracks, 'paste', 'Pasted list', { lookup })}>
        Import {result?.tracks.length ?? 0} song{result?.tracks.length === 1 ? '' : 's'}
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ manual

function ManualTab({ role, commit }: { role: TrackRole; commit: Commit }) {
  const [f, setF] = useState({ title: '', artist: '', album: '', dur: '', art: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => titleRef.current?.focus(), [])
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))
  const dur = f.dur.trim() ? parseDuration(f.dur) : null
  const durBad = f.dur.trim() !== '' && dur === null

  const find = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const m = await lookupSong(f.title, f.artist)
      if (!m) setMsg("Couldn't find a match. Check the spelling or fill the details in by hand.")
      else {
        setF((p) => ({ ...p, album: p.album || m.album, dur: p.dur || (m.durationSec ? fmtDuration(m.durationSec) : ''), art: p.art || m.artwork || '' }))
        setMsg(`Found "${m.matchedTitle}" by ${m.matchedArtist}.`)
      }
    } catch (e) {
      setMsg(e instanceof ImportError ? e.message : "The lookup didn't work. Fill the details in by hand.")
    } finally {
      setBusy(false)
    }
  }

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.title.trim() || durBad) return
    const ok = commit([{ title: f.title.trim(), artist: f.artist.trim() || 'Unknown artist', album: f.album.trim(), durationSec: dur && dur > 0 ? dur : null, artwork: safeArtworkUrl(f.art), role }], 'manual', undefined, { keepOpen: true })
    if (ok) {
      setF({ title: '', artist: '', album: '', dur: '', art: '' })
      setMsg(null)
      titleRef.current?.focus()
    }
  }

  return (
    <form onSubmit={add}>
      <h3 className="h-sub mb-2">Add a song by hand</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Song title" htmlFor="m-title">
          <input ref={titleRef} id="m-title" className="field" value={f.title} onChange={(e) => set('title', e.target.value)} required maxLength={300} autoComplete="off" />
        </Field>
        <Field label="Artist" htmlFor="m-artist">
          <input id="m-artist" className="field" value={f.artist} onChange={(e) => set('artist', e.target.value)} maxLength={300} autoComplete="off" />
        </Field>
        <Field label="Album" htmlFor="m-album">
          <input id="m-album" className="field" value={f.album} onChange={(e) => set('album', e.target.value)} maxLength={300} autoComplete="off" />
        </Field>
        <Field label="Length (m:ss)" htmlFor="m-dur" hint={durBad ? 'Use minutes and seconds, like 3:45.' : undefined}>
          <input id="m-dur" className={`field mono ${durBad ? '!border-pink !bg-pink/30' : ''}`} value={f.dur} onChange={(e) => set('dur', e.target.value)} placeholder="3:45" aria-invalid={durBad || undefined} autoComplete="off" />
        </Field>
      </div>
      {f.art && <p className="hint mt-2">Artwork found and attached.</p>}
      {msg && <p className="mt-2 font-bold" role="status">{msg}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={!f.title.trim() || durBad} data-testid="manual-add">
          <Icon name="plus" className="h-5 w-5" />
          Add to crate
        </button>
        <button type="button" className="btn" disabled={busy || !f.title.trim()} onClick={() => void find()} title="Look up length, album and artwork on Apple's public search">
          {busy ? <Busy>Looking...</Busy> : 'Look up details'}
        </button>
      </div>
    </form>
  )
}
