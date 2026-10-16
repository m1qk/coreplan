import { safeArtworkUrl } from '../csv'
import { ImportError, safeFetch, type FetchFn } from './common'

/**
 * Look up duration, album and artwork for songs that have none (typed or
 * pasted lists). Uses Apple's public iTunes Search API, which needs no key.
 * Apple limits it to roughly 20 requests per minute, so lookups are spaced out
 * and retried gently.
 */

export interface ItunesMatch {
  durationSec: number | null
  album: string
  artwork?: string
  matchedTitle: string
  matchedArtist: string
}

interface ItunesResult {
  trackName?: string
  artistName?: string
  collectionName?: string
  trackTimeMillis?: number
  artworkUrl100?: string
}

export function normText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ') // (feat. X), [Remastered]
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Choose the best result, or null when nothing is a convincing match. */
export function pickBestMatch(results: ItunesResult[], title: string, artist: string): ItunesMatch | null {
  const wantT = normText(title)
  const wantA = normText(artist)
  let best: { score: number; r: ItunesResult } | null = null
  for (const r of results) {
    if (!r.trackName) continue
    const t = normText(r.trackName)
    const a = normText(r.artistName ?? '')
    let score = 0
    if (t === wantT) score += 3
    else if (t.includes(wantT) || wantT.includes(t)) score += 1
    if (wantA && wantA !== 'unknown artist') {
      if (a === wantA) score += 3
      else if (a.includes(wantA) || wantA.includes(a)) score += 2
    } else score += 1
    if (!best || score > best.score) best = { score, r }
  }
  if (!best || best.score < 4) return null
  const r = best.r
  return {
    durationSec: typeof r.trackTimeMillis === 'number' && r.trackTimeMillis > 0 ? Math.round(r.trackTimeMillis / 1000) : null,
    album: r.collectionName ?? '',
    artwork: safeArtworkUrl(r.artworkUrl100?.replace(/\/\d+x\d+bb\./, '/300x300bb.')),
    matchedTitle: r.trackName ?? '',
    matchedArtist: r.artistName ?? '',
  }
}

export async function lookupSong(
  title: string,
  artist: string,
  fetchFn: FetchFn = fetch,
  signal?: AbortSignal,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<ItunesMatch | null> {
  const term = encodeURIComponent(`${artist && artist !== 'Unknown artist' ? artist + ' ' : ''}${title}`)
  const url = `https://itunes.apple.com/search?term=${term}&entity=song&media=music&limit=5`
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await safeFetch(fetchFn, url, { signal })
    if (res.status === 403 || res.status === 429) {
      await sleep(4000 * (attempt + 1))
      continue
    }
    if (!res.ok) throw new ImportError('unexpected', `The song lookup service returned an error (${res.status}).`)
    const j = (await res.json()) as { results?: ItunesResult[] }
    return pickBestMatch(j.results ?? [], title, artist)
  }
  throw new ImportError('rate-limited', 'The lookup service is rate limiting us. Wait a minute and try again.')
}

export interface LookupInput {
  id: string
  title: string
  artist: string
  album: string
  durationSec: number | null
  artwork?: string
}

export interface LookupOutcome {
  id: string
  match: ItunesMatch | null
}

/** Look up many songs one at a time with a small gap; reports progress and can be cancelled. */
export async function lookupMany(
  songs: LookupInput[],
  opts: {
    fetchFn?: FetchFn
    signal?: AbortSignal
    onProgress?: (done: number, total: number) => void
    gapMs?: number
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<{ outcomes: LookupOutcome[]; error?: ImportError }> {
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  const outcomes: LookupOutcome[] = []
  let error: ImportError | undefined
  for (let i = 0; i < songs.length; i++) {
    if (opts.signal?.aborted) break
    try {
      const match = await lookupSong(songs[i].title, songs[i].artist, opts.fetchFn, opts.signal, sleep)
      outcomes.push({ id: songs[i].id, match })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') break
      if (e instanceof ImportError) {
        error = e
        break
      }
      throw e
    }
    opts.onProgress?.(i + 1, songs.length)
    if (i < songs.length - 1) await sleep(opts.gapMs ?? 350)
  }
  return { outcomes, error }
}
