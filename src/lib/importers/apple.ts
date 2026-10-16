import type { ParsedTrack } from '../csv'
import { safeArtworkUrl } from '../csv'
import { ImportError, safeFetch, type FetchedPlaylist, type FetchFn } from './common'

/**
 * Apple Music import using the official Apple Music API.
 *
 * What works with only a Developer Token (no user sign-in): any playlist that
 * has a public share link, which has an id starting "pl." (for example
 * https://music.apple.com/us/playlist/name/pl.u-AbCdEf). Apple's catalog API
 * returns its songs with name, artist, album, length and artwork.
 *
 * NOT implemented: reading a person's private library playlists (ids starting
 * "p."). That requires MusicKit JS user authorization. Share the playlist from
 * the Music app ("Share > Copy Link") to import it here instead.
 *
 * The Developer Token is a JWT signed with a private key from an Apple
 * Developer Program account. The key must never be in the browser: generate
 * the token with `npm run apple-token` and paste it into the app.
 */

const API = 'https://api.music.apple.com'

export interface ApplePlaylistRef {
  storefront: string
  id: string
}

export function parseApplePlaylistUrl(input: string): ApplePlaylistRef | null {
  const m = input.trim().match(/music\.apple\.com\/([a-z]{2})\/playlist\/(?:[^/?#]+\/)?(pl\.[A-Za-z0-9_-]+)/i)
  return m ? { storefront: m[1].toLowerCase(), id: m[2] } : null
}

export function isApplePrivateLibraryLink(input: string): boolean {
  return /music\.apple\.com\/(?:[a-z]{2}\/)?library\/playlist\/p\./i.test(input) || /\/playlist\/(?:[^/?#]+\/)?p\.[A-Za-z0-9_-]+/i.test(input)
}

export interface TokenInfo {
  ok: boolean
  expired?: boolean
  expiresAt?: number
  problem?: string
}

/** Look inside a developer token (without trusting it) so the UI can warn about expiry early. */
export function inspectDeveloperToken(token: string, now: number = Date.now()): TokenInfo {
  const parts = token.trim().split('.')
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) {
    return { ok: false, problem: 'That does not look like a developer token (it should be three parts separated by dots).' }
  }
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '='))) as { exp?: number }
    if (typeof payload.exp === 'number') {
      const expiresAt = payload.exp * 1000
      if (expiresAt <= now) return { ok: false, expired: true, expiresAt, problem: 'This developer token has expired. Generate a new one.' }
      return { ok: true, expiresAt }
    }
    return { ok: true }
  } catch {
    return { ok: false, problem: 'The token could not be decoded.' }
  }
}

interface AppleSong {
  type?: string
  attributes?: {
    name?: string
    artistName?: string
    albumName?: string
    durationInMillis?: number
    artwork?: { url?: string }
  }
}

export function normalizeAppleSong(s: AppleSong): ParsedTrack | null {
  if (s.type && s.type !== 'songs' && s.type !== 'library-songs') return null // music videos etc.
  const a = s.attributes
  if (!a?.name) return null
  const art = a.artwork?.url?.replace('{w}', '300').replace('{h}', '300')
  return {
    title: a.name,
    artist: a.artistName || 'Unknown artist',
    album: a.albumName ?? '',
    durationSec: typeof a.durationInMillis === 'number' && a.durationInMillis > 0 ? Math.round(a.durationInMillis / 1000) : null,
    artwork: safeArtworkUrl(art),
    role: 'personal',
  }
}

function mapStatus(status: number): ImportError {
  if (status === 401) return new ImportError('auth-expired', 'Apple rejected the developer token. It may be expired or signed with the wrong key. Generate a new one.')
  if (status === 403) return new ImportError('forbidden', "Apple won't let this token read that playlist.")
  if (status === 404) return new ImportError('not-found', "Apple couldn't find that playlist. Make sure it is shared publicly and the link is right.")
  if (status === 429) return new ImportError('rate-limited', 'Apple says slow down. Try again in a minute.')
  return new ImportError('unexpected', `Apple Music returned an unexpected error (${status}).`)
}

export async function fetchApplePlaylist(
  ref: ApplePlaylistRef,
  developerToken: string,
  fetchFn: FetchFn = fetch,
  onProgress?: (loaded: number) => void,
): Promise<FetchedPlaylist> {
  const headers = { Authorization: `Bearer ${developerToken.trim()}` }
  const first = await safeFetch(fetchFn, `${API}/v1/catalog/${ref.storefront}/playlists/${ref.id}?include=tracks`, { headers })
  if (!first.ok) throw mapStatus(first.status)
  const body = (await first.json()) as {
    data?: Array<{
      attributes?: { name?: string }
      relationships?: { tracks?: { data?: AppleSong[]; next?: string } }
    }>
  }
  const pl = body.data?.[0]
  if (!pl) throw new ImportError('not-found', "Apple didn't return that playlist.")
  const tracks: ParsedTrack[] = []
  let skipped = 0
  const take = (list: AppleSong[] | undefined) => {
    for (const s of list ?? []) {
      const t = normalizeAppleSong(s)
      if (t) tracks.push(t)
      else skipped++
    }
    onProgress?.(tracks.length)
  }
  take(pl.relationships?.tracks?.data)
  let next = pl.relationships?.tracks?.next
  let pages = 0
  while (next && pages < 100) {
    // `next` is a path like /v1/catalog/us/playlists/pl.x/tracks?offset=100
    const url = next.startsWith('http') ? next : `${API}${next}`
    if (!url.startsWith(API)) break // never send the token to another host
    const res = await safeFetch(fetchFn, url, { headers })
    if (!res.ok) throw mapStatus(res.status)
    const page = (await res.json()) as { data?: AppleSong[]; next?: string }
    take(page.data)
    next = page.next
    pages++
  }
  return { name: pl.attributes?.name ?? 'Apple Music playlist', tracks, skipped }
}
