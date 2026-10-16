import { generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error plain .mjs script, typed by apple-token.d.ts
import { createDeveloperToken, MAX_TOKEN_SECONDS } from '../../../scripts/apple-token.mjs'
import { ImportError } from './common'
import {
  buildAuthorizeUrl,
  completeLoginIfPresent,
  fetchSpotifyPlaylist,
  getStoredToken,
  normalizeSpotifyElement,
  parseSpotifyPlaylistId,
  pkceChallenge,
  spotifyLinkKind,
  validRedirectUri,
  type StorageLike,
} from './spotify'
import { fetchApplePlaylist, inspectDeveloperToken, isApplePrivateLibraryLink, normalizeAppleSong, parseApplePlaylistUrl } from './apple'
import { lookupMany, lookupSong, normText, pickBestMatch } from './itunes'

const memoryStorage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('Spotify links', () => {
  const id = '37i9dQZF1DXcBWIGoYBM5M'
  it('parses playlist URLs in the common shapes', () => {
    expect(parseSpotifyPlaylistId(`https://open.spotify.com/playlist/${id}`)).toBe(id)
    expect(parseSpotifyPlaylistId(`https://open.spotify.com/playlist/${id}?si=abc123`)).toBe(id)
    expect(parseSpotifyPlaylistId(`https://open.spotify.com/intl-de/playlist/${id}`)).toBe(id)
    expect(parseSpotifyPlaylistId(`spotify:playlist:${id}`)).toBe(id)
    expect(parseSpotifyPlaylistId(id)).toBe(id)
    expect(parseSpotifyPlaylistId(`  https://open.spotify.com/playlist/${id}  `)).toBe(id)
  })
  it('rejects things that are not playlists', () => {
    expect(parseSpotifyPlaylistId('https://open.spotify.com/album/' + id)).toBeNull()
    expect(parseSpotifyPlaylistId('https://example.com')).toBeNull()
    expect(parseSpotifyPlaylistId('')).toBeNull()
  })
  it('identifies album/track links for a better message', () => {
    expect(spotifyLinkKind(`https://open.spotify.com/album/${id}`)).toBe('album')
    expect(spotifyLinkKind(`https://open.spotify.com/track/${id}`)).toBe('track')
    expect(spotifyLinkKind('hello')).toBe('none')
  })
})

describe('Spotify PKCE', () => {
  it('matches the RFC 7636 appendix B test vector', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('builds an authorize URL with S256 challenge, scopes, state and no secret', async () => {
    const st = memoryStorage()
    const url = new URL(await buildAuthorizeUrl('client123', 'https://dj.example.org/', st))
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('client123')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('redirect_uri')).toBe('https://dj.example.org/')
    expect(url.searchParams.get('scope')).toContain('playlist-read-private')
    expect(url.searchParams.get('state')).toBe(st.getItem('core.spotify.state'))
    expect(url.searchParams.has('client_secret')).toBe(false)
    const verifier = st.getItem('core.spotify.verifier')!
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(url.searchParams.get('code_challenge')).toBe(await pkceChallenge(verifier))
  })

  it('exchanges the code for a token, verifying state', async () => {
    const st = memoryStorage()
    await buildAuthorizeUrl('client123', 'https://dj.example.org/', st)
    const state = st.getItem('core.spotify.state')!
    const verifier = st.getItem('core.spotify.verifier')!
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = new URLSearchParams(init?.body as URLSearchParams)
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code')).toBe('CODE')
      expect(body.get('code_verifier')).toBe(verifier)
      expect(body.get('client_id')).toBe('client123')
      expect(body.has('client_secret')).toBe(false)
      return json({ access_token: 'tok', expires_in: 3600, refresh_token: 'r' })
    }) as unknown as typeof fetch
    const r = await completeLoginIfPresent(`?code=CODE&state=${state}`, st, fetchFn, () => 1000)
    expect(r).toEqual({ ok: true })
    expect(getStoredToken(st, () => 2000)?.accessToken).toBe('tok')
    expect(getStoredToken(st, () => 1000 + 3600_000)).toBeNull() // expired
    expect(st.getItem('core.spotify.verifier')).toBeNull() // single use
  })

  it('refuses a callback whose state does not match', async () => {
    const st = memoryStorage()
    await buildAuthorizeUrl('client123', 'https://dj.example.org/', st)
    const fetchFn = vi.fn() as unknown as typeof fetch
    const r = await completeLoginIfPresent('?code=CODE&state=forged', st, fetchFn)
    expect(r).toMatchObject({ ok: false })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('ignores URLs that are not a Spotify callback and handles a declined login', async () => {
    const st = memoryStorage()
    expect(await completeLoginIfPresent('?foo=bar', st)).toBeNull()
    await buildAuthorizeUrl('c', 'https://x.org/', st)
    const state = st.getItem('core.spotify.state')!
    expect(await completeLoginIfPresent(`?error=access_denied&state=${state}`, st)).toEqual({ ok: false, message: 'Spotify sign-in was cancelled.' })
  })

  it('validates redirect URIs the way Spotify does', () => {
    expect(validRedirectUri('https://dj.example.org/')).toBeNull()
    expect(validRedirectUri('http://127.0.0.1:4173/')).toBeNull()
    expect(validRedirectUri('http://localhost:4173/')).toContain('127.0.0.1')
    expect(validRedirectUri('http://example.org/')).toContain('https')
    expect(validRedirectUri('nonsense')).toContain('valid')
  })
})

describe('Spotify playlist fetching', () => {
  const track = (name: string, ms = 225000) => ({
    type: 'track',
    name,
    duration_ms: ms,
    artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
    album: {
      name: 'Album X',
      images: [
        { url: 'https://i.scdn.co/image/640', width: 640 },
        { url: 'https://i.scdn.co/image/300', width: 300 },
        { url: 'https://i.scdn.co/image/64', width: 64 },
      ],
    },
  })

  it('normalizes both the new `item` and old `track` element shapes', () => {
    const a = normalizeSpotifyElement({ item: track('New Shape') })
    const b = normalizeSpotifyElement({ track: track('Old Shape') })
    expect(a).toMatchObject({ title: 'New Shape', artist: 'Artist A, Artist B', album: 'Album X', durationSec: 225, artwork: 'https://i.scdn.co/image/300' })
    expect(b?.title).toBe('Old Shape')
  })

  it('skips local files, episodes, nulls and nameless entries', () => {
    expect(normalizeSpotifyElement({ item: null })).toBeNull()
    expect(normalizeSpotifyElement({ item: { ...track('x'), is_local: true } })).toBeNull()
    expect(normalizeSpotifyElement({ item: { ...track('x'), type: 'episode' } })).toBeNull()
    expect(normalizeSpotifyElement({ item: { type: 'track' } })).toBeNull()
    expect(normalizeSpotifyElement(undefined)).toBeNull()
  })

  it('follows pagination, reports skipped items and sends the bearer token', async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      calls.push(u)
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN')
      if (u.includes('fields=name')) return json({ name: 'My Mix' })
      if (u.includes('/items?limit=50')) return json({ items: [{ item: track('One') }, { item: null }], next: 'https://api.spotify.com/v1/playlists/abc/items?offset=50&limit=50' })
      return json({ items: [{ item: track('Two', 0) }], next: null })
    }) as unknown as typeof fetch
    const r = await fetchSpotifyPlaylist('abc', 'TOKEN', fetchFn)
    expect(r.name).toBe('My Mix')
    expect(r.tracks.map((t) => t.title)).toEqual(['One', 'Two'])
    expect(r.tracks[1].durationSec).toBeNull() // 0 ms is "unknown", not a real zero
    expect(r.skipped).toBe(1)
    expect(calls.some((c) => c.includes('/playlists/abc/items'))).toBe(true)
    expect(calls.some((c) => c.endsWith('/tracks') || c.includes('/tracks?'))).toBe(false) // uses the renamed endpoint
  })

  it.each([
    [401, 'auth-expired'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [429, 'rate-limited'],
    [500, 'unexpected'],
  ])('maps HTTP %i to a %s error', async (status, code) => {
    const fetchFn = vi.fn(async (url: unknown) => (String(url).includes('fields=name') ? json({ name: 'n' }) : json({}, status, { 'Retry-After': '7' }))) as unknown as typeof fetch
    await expect(fetchSpotifyPlaylist('abc', 't', fetchFn)).rejects.toMatchObject({ code })
  })

  it('turns a network failure into a friendly error', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    await expect(fetchSpotifyPlaylist('abc', 't', fetchFn)).rejects.toBeInstanceOf(ImportError)
    await expect(fetchSpotifyPlaylist('abc', 't', fetchFn)).rejects.toMatchObject({ code: 'network' })
  })
})

describe('Apple Music', () => {
  it('parses share links and recognizes private library links', () => {
    expect(parseApplePlaylistUrl('https://music.apple.com/us/playlist/summer-mix/pl.u-AbC123xyz?l=en')).toEqual({ storefront: 'us', id: 'pl.u-AbC123xyz' })
    expect(parseApplePlaylistUrl('https://music.apple.com/gb/playlist/pl.abcdef123')).toEqual({ storefront: 'gb', id: 'pl.abcdef123' })
    expect(parseApplePlaylistUrl('https://music.apple.com/us/album/x/123')).toBeNull()
    expect(isApplePrivateLibraryLink('https://music.apple.com/library/playlist/p.AbCdEf')).toBe(true)
    expect(isApplePrivateLibraryLink('https://music.apple.com/us/playlist/x/pl.u-AbC')).toBe(false)
  })

  it('normalizes a catalog song (artwork template filled, music videos skipped)', () => {
    expect(
      normalizeAppleSong({
        type: 'songs',
        attributes: { name: 'Song', artistName: 'Band', albumName: 'LP', durationInMillis: 199500, artwork: { url: 'https://is1.mzstatic.com/image/{w}x{h}bb.jpg' } },
      }),
    ).toMatchObject({ title: 'Song', artist: 'Band', album: 'LP', durationSec: 200, artwork: 'https://is1.mzstatic.com/image/300x300bb.jpg' })
    expect(normalizeAppleSong({ type: 'music-videos', attributes: { name: 'Vid' } })).toBeNull()
  })

  it('fetches a playlist with pagination and never sends the token to another host', async () => {
    const song = (n: string) => ({ type: 'songs', attributes: { name: n, artistName: 'B', albumName: 'L', durationInMillis: 180000 } })
    const seen: string[] = []
    const fetchFn = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      seen.push(u)
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer DEVTOKEN')
      if (u.includes('?include=tracks'))
        return json({ data: [{ attributes: { name: 'Shared Mix' }, relationships: { tracks: { data: [song('A'), { type: 'music-videos', attributes: { name: 'V' } }], next: '/v1/catalog/us/playlists/pl.u-x/tracks?offset=100' } } }] })
      return json({ data: [song('B')], next: 'https://evil.example.com/steal' })
    }) as unknown as typeof fetch
    const r = await fetchApplePlaylist({ storefront: 'us', id: 'pl.u-x' }, 'DEVTOKEN', fetchFn)
    expect(r.name).toBe('Shared Mix')
    expect(r.tracks.map((t) => t.title)).toEqual(['A', 'B'])
    expect(r.skipped).toBe(1)
    expect(seen.every((s) => s.startsWith('https://api.music.apple.com/'))).toBe(true)
  })

  it.each([
    [401, 'auth-expired'],
    [403, 'forbidden'],
    [404, 'not-found'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const fetchFn = vi.fn(async () => json({}, status)) as unknown as typeof fetch
    await expect(fetchApplePlaylist({ storefront: 'us', id: 'pl.x' }, 't', fetchFn)).rejects.toMatchObject({ code })
  })

  it('inspects tokens for shape and expiry', () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const good = `${b64({ alg: 'ES256' })}.${b64({ exp: 2_000_000_000 })}.sig`
    const old = `${b64({ alg: 'ES256' })}.${b64({ exp: 1000 })}.sig`
    expect(inspectDeveloperToken(good, 1_700_000_000_000).ok).toBe(true)
    expect(inspectDeveloperToken(old, 1_700_000_000_000)).toMatchObject({ ok: false, expired: true })
    expect(inspectDeveloperToken('not a token').ok).toBe(false)
  })
})

describe('apple-token script', () => {
  it('produces a valid ES256 JWT whose signature verifies with the public key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
    const token: string = createDeveloperToken({ privateKeyPem: pem, teamId: 'TEAM123456', keyId: 'KEY1234567', days: 30, now: 1_800_000_000 })
    const [h, p, s] = token.split('.')
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' })
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({ iss: 'TEAM123456', iat: 1_800_000_000, exp: 1_800_000_000 + 30 * 86400 })
    const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))
    expect(ok).toBe(true)
    expect(Buffer.from(s, 'base64url')).toHaveLength(64) // raw r||s, not DER
  })
  it('refuses lifetimes over Apple’s 6 month limit', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
    expect(() => createDeveloperToken({ privateKeyPem: pem, teamId: 't', keyId: 'k', days: Math.ceil(MAX_TOKEN_SECONDS / 86400) + 5 })).toThrow(/6 month/)
  })
})

describe('iTunes lookup', () => {
  const results = [
    { trackName: 'Boombox Heart (Remastered)', artistName: 'The Paper Moons', collectionName: 'Skate Wax Sessions', trackTimeMillis: 245000, artworkUrl100: 'https://is1.mzstatic.com/image/100x100bb.jpg' },
    { trackName: 'Boombox Heart (Karaoke)', artistName: 'Cover Band', collectionName: 'Karaoke Hits', trackTimeMillis: 190000 },
  ]
  it('normalizes text for comparison', () => {
    expect(normText('Song (feat. X) [Live]')).toBe('song')
  })
  it('picks the right artist and upsizes artwork', () => {
    const m = pickBestMatch(results, 'Boombox Heart', 'The Paper Moons')
    expect(m).toMatchObject({ durationSec: 245, album: 'Skate Wax Sessions', artwork: 'https://is1.mzstatic.com/image/300x300bb.jpg' })
  })
  it('returns null for weak matches', () => {
    expect(pickBestMatch(results, 'Totally Different', 'Nobody')).toBeNull()
  })
  it('retries politely when rate limited, then succeeds', async () => {
    let n = 0
    const fetchFn = vi.fn(async () => (++n < 2 ? new Response('', { status: 403 }) : json({ results }))) as unknown as typeof fetch
    const sleep = vi.fn(async () => {})
    const m = await lookupSong('Boombox Heart', 'The Paper Moons', fetchFn, undefined, sleep)
    expect(m?.durationSec).toBe(245)
    expect(sleep).toHaveBeenCalledTimes(1)
  })
  it('lookupMany reports progress and stops on a hard error', async () => {
    let n = 0
    const fetchFn = vi.fn(async () => (++n === 2 ? new Response('', { status: 500 }) : json({ results }))) as unknown as typeof fetch
    const progress: number[] = []
    const out = await lookupMany(
      [1, 2, 3].map((i) => ({ id: String(i), title: 'Boombox Heart', artist: 'The Paper Moons', album: '', durationSec: null })),
      { fetchFn, sleep: async () => {}, onProgress: (d) => progress.push(d) },
    )
    expect(out.outcomes).toHaveLength(1)
    expect(out.error?.code).toBe('unexpected')
    expect(progress).toEqual([1])
  })
})
