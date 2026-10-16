import type { ParsedTrack } from '../csv'
import { safeArtworkUrl } from '../csv'
import { ImportError, pickImage, safeFetch, type FetchedPlaylist, type FetchFn } from './common'

/**
 * Spotify import using the official Web API with the Authorization Code +
 * PKCE flow. PKCE needs only a Client ID (no client secret), so it is safe to
 * run in a browser. Requirements and limits are documented in the README.
 *
 * Verified against Spotify's February 2026 migration guide:
 *  - tracks are read with GET /playlists/{id}/items (renamed from /tracks)
 *  - each element holds the track under `item` (formerly `track`)
 *  - items are only returned for playlists the user owns or collaborates on
 */

export const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative'
const API = 'https://api.spotify.com/v1'
const AUTH_URL = 'https://accounts.spotify.com/authorize'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'

const K = {
  verifier: 'core.spotify.verifier',
  state: 'core.spotify.state',
  clientId: 'core.spotify.clientId',
  redirect: 'core.spotify.redirect',
  token: 'core.spotify.token',
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface SpotifyToken {
  accessToken: string
  expiresAt: number
  refreshToken?: string
}

// --- links ---------------------------------------------------------------

/** Accepts open.spotify.com URLs (with locale or query), spotify: URIs, or a bare 22 character ID. */
export function parseSpotifyPlaylistId(input: string): string | null {
  const s = input.trim()
  const url = s.match(/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[A-Za-z]+)?\/)?(?:embed\/)?playlist\/([A-Za-z0-9]{22})/)
  if (url) return url[1]
  const uri = s.match(/^spotify:(?:user:[^:]+:)?playlist:([A-Za-z0-9]{22})$/)
  if (uri) return uri[1]
  if (/^[A-Za-z0-9]{22}$/.test(s)) return s
  return null
}

/** Album and track links are a common mistake; detect them to give a better message. */
export function spotifyLinkKind(input: string): 'playlist' | 'album' | 'track' | 'other' | 'none' {
  const m = input.match(/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[A-Za-z]+)?\/)?(playlist|album|track|artist|show|episode)\//)
  if (!m) return /^spotify:/.test(input.trim()) ? 'other' : 'none'
  return m[1] === 'playlist' || m[1] === 'album' || m[1] === 'track' ? m[1] : 'other'
}

// --- PKCE ----------------------------------------------------------------

export function base64Url(bytes: Uint8Array): string {
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomString(byteLength = 48): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

export function validRedirectUri(uri: string): string | null {
  try {
    const u = new URL(uri)
    const loopback = u.hostname === '127.0.0.1' || u.hostname === '[::1]'
    if (u.protocol === 'https:' || (u.protocol === 'http:' && loopback)) return null
    if (u.hostname === 'localhost') return 'Spotify does not accept "localhost". Use http://127.0.0.1:PORT/ for local testing.'
    return 'Spotify requires https (or http://127.0.0.1 for local testing).'
  } catch {
    return 'That is not a valid URL.'
  }
}

/** Build the Spotify authorize URL and remember the PKCE verifier/state for the return trip. */
export async function buildAuthorizeUrl(clientId: string, redirectUri: string, storage: StorageLike): Promise<string> {
  const verifier = randomString(48)
  const state = randomString(16)
  storage.setItem(K.verifier, verifier)
  storage.setItem(K.state, state)
  storage.setItem(K.clientId, clientId)
  storage.setItem(K.redirect, redirectUri)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SPOTIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
    code_challenge_method: 'S256',
    code_challenge: await pkceChallenge(verifier),
  })
  return `${AUTH_URL}?${params.toString()}`
}

/**
 * Call on page load. If the URL carries a Spotify "?code=...&state=..." (or an
 * error) it finishes the login and returns the outcome; otherwise null.
 */
export async function completeLoginIfPresent(
  search: string,
  storage: StorageLike,
  fetchFn: FetchFn = fetch,
  now: () => number = Date.now,
): Promise<{ ok: true } | { ok: false; message: string } | null> {
  const p = new URLSearchParams(search)
  const code = p.get('code')
  const err = p.get('error')
  const state = p.get('state')
  if (!code && !err) return null
  const expected = storage.getItem(K.state)
  if (!expected || !state || state !== expected) {
    // Not our flow (or a forged callback). Ignore it rather than exchanging the code.
    if (!storage.getItem(K.verifier)) return null
    return { ok: false, message: 'Spotify sign-in could not be verified. Please try connecting again.' }
  }
  storage.removeItem(K.state)
  if (err) {
    storage.removeItem(K.verifier)
    return { ok: false, message: err === 'access_denied' ? 'Spotify sign-in was cancelled.' : `Spotify sign-in failed (${err}).` }
  }
  const verifier = storage.getItem(K.verifier)
  const clientId = storage.getItem(K.clientId)
  const redirect = storage.getItem(K.redirect)
  storage.removeItem(K.verifier)
  if (!verifier || !clientId || !redirect) return { ok: false, message: 'Spotify sign-in expired. Please try connecting again.' }
  const res = await safeFetch(fetchFn, TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code as string,
      redirect_uri: redirect,
      client_id: clientId,
      code_verifier: verifier,
    }),
  })
  if (!res.ok) {
    return { ok: false, message: 'Spotify rejected the sign-in. Check that your Client ID and Redirect URI match the Spotify dashboard exactly.' }
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number; refresh_token?: string }
  if (!body.access_token) return { ok: false, message: 'Spotify did not return an access token.' }
  const token: SpotifyToken = {
    accessToken: body.access_token,
    expiresAt: now() + (body.expires_in ?? 3600) * 1000,
    refreshToken: body.refresh_token,
  }
  storage.setItem(K.token, JSON.stringify(token))
  return { ok: true }
}

export function getStoredToken(storage: StorageLike, now: () => number = Date.now): SpotifyToken | null {
  try {
    const raw = storage.getItem(K.token)
    if (!raw) return null
    const t = JSON.parse(raw) as SpotifyToken
    if (!t.accessToken || typeof t.expiresAt !== 'number') return null
    return t.expiresAt - 30_000 > now() ? t : null // treat near-expiry as expired
  } catch {
    return null
  }
}

export function disconnectSpotify(storage: StorageLike): void {
  for (const k of Object.values(K)) if (k !== K.clientId && k !== K.redirect) storage.removeItem(k)
}

// --- fetching ------------------------------------------------------------

interface SpotifyTrackObject {
  type?: string
  name?: string
  duration_ms?: number
  is_local?: boolean
  artists?: Array<{ name?: string }>
  album?: { name?: string; images?: Array<{ url?: string; width?: number | null }> }
}

/** Convert one playlist element. Handles both the new `item` and old `track` shapes. */
export function normalizeSpotifyElement(el: unknown): ParsedTrack | null {
  if (!el || typeof el !== 'object') return null
  const rec = el as { item?: SpotifyTrackObject | null; track?: SpotifyTrackObject | null; is_local?: boolean }
  const t = rec.item ?? rec.track
  if (!t || typeof t !== 'object') return null
  if (t.is_local || rec.is_local) return null
  if (t.type && t.type !== 'track') return null // podcast episodes
  if (!t.name) return null
  return {
    title: t.name,
    artist: (t.artists ?? []).map((a) => a.name).filter(Boolean).join(', ') || 'Unknown artist',
    album: t.album?.name ?? '',
    durationSec: typeof t.duration_ms === 'number' && t.duration_ms > 0 ? Math.round(t.duration_ms / 1000) : null,
    artwork: safeArtworkUrl(pickImage(t.album?.images)),
    role: 'personal',
  }
}

function mapStatus(status: number, retryAfter: string | null): ImportError {
  if (status === 401) return new ImportError('auth-expired', 'Your Spotify session expired. Connect to Spotify again.')
  if (status === 403)
    return new ImportError(
      'forbidden',
      "Spotify won't let this app read that playlist. Under Spotify's 2026 rules an app can only read tracks from playlists you own or collaborate on, and your account must be allowed on the app. Use the CSV or paste options instead.",
    )
  if (status === 404) return new ImportError('not-found', "Spotify couldn't find that playlist. Check the link, or the playlist may be private.")
  if (status === 429) return new ImportError('rate-limited', `Spotify says slow down. Try again${retryAfter ? ` in ${retryAfter} seconds` : ' in a minute'}.`)
  return new ImportError('unexpected', `Spotify returned an unexpected error (${status}).`)
}

export async function fetchSpotifyPlaylist(
  playlistId: string,
  accessToken: string,
  fetchFn: FetchFn = fetch,
  onProgress?: (loaded: number) => void,
): Promise<FetchedPlaylist> {
  const headers = { Authorization: `Bearer ${accessToken}` }
  let name = 'Spotify playlist'
  const meta = await safeFetch(fetchFn, `${API}/playlists/${playlistId}?fields=name`, { headers })
  if (meta.ok) {
    const j = (await meta.json()) as { name?: string }
    if (j.name) name = j.name
  } else if (meta.status === 401 || meta.status === 404 || meta.status === 429) {
    throw mapStatus(meta.status, meta.headers.get('Retry-After'))
  }
  // Any other status (e.g. 403) falls through: the items request below reports it properly.

  const tracks: ParsedTrack[] = []
  let skipped = 0
  let url: string | null = `${API}/playlists/${playlistId}/items?limit=50&additional_types=track`
  let pages = 0
  while (url && pages < 100) {
    const res = await safeFetch(fetchFn, url, { headers })
    if (!res.ok) throw mapStatus(res.status, res.headers.get('Retry-After'))
    const page = (await res.json()) as { items?: unknown[]; next?: string | null }
    for (const el of page.items ?? []) {
      const t = normalizeSpotifyElement(el)
      if (t) tracks.push(t)
      else skipped++
    }
    onProgress?.(tracks.length)
    url = page.next ?? null
    pages++
  }
  return { name, tracks, skipped }
}
