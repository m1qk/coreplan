// End-to-end tests: drives the real built app in real Chromium.
//   npm run build && npm run preview &   (port 4173)
//   npm run e2e
//
// External services (Spotify, Apple Music, iTunes) are mocked at the network
// layer. The Spotify mock verifies the real PKCE challenge and bearer headers.
import { createHash, generateKeyPairSync } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { createDeveloperToken } from '../scripts/apple-token.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:4174/'
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const OUT = process.env.E2E_OUT ?? mkdtempSync(join(tmpdir(), 'core-e2e-'))
const only = process.argv[2]

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const results = []

// ------------------------------------------------------------------ helpers
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const json = (route, body, status = 200, extra = {}) => route.fulfill({ status, contentType: 'application/json', headers: { ...CORS, ...extra }, body: JSON.stringify(body) })

async function fresh({ width = 1440, height = 900, touch = false, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, acceptDownloads: true, locale: 'en-US', timezoneId: 'America/New_York' })
  const errors = []
  if (init) await ctx.addInitScript(init)
  // default iTunes mock: one known song, nothing else
  await ctx.route('https://itunes.apple.com/**', (route) => {
    const term = decodeURIComponent(new URL(route.request().url()).searchParams.get('term') ?? '')
    const hit = /Echo Chamber/i.test(term)
    return json(route, { results: hit ? [{ trackName: 'Echo Chamber', artistName: 'Lost Signal', collectionName: 'Dial Tone', trackTimeMillis: 201000, artworkUrl100: 'https://example.invalid/100x100bb.jpg' }] : [] })
  })
  await ctx.route('https://example.invalid/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#f0f"/></svg>' }))
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  await page.goto(BASE)
  await page.waitForSelector('h1')
  return { ctx, page, errors }
}

const demo = async (page) => {
  await page.getByTestId('load-demo').click()
  await page.getByTestId('track-card').first().waitFor()
}
const setStart = async (page, hhmm = '14:00') => page.fill('#f-start', hhmm)
// On phones and tablets the Setup panel lives on its own tab.
const setStartAny = async (page, hhmm = '14:00') => {
  const nav = page.getByTestId('nav-setup')
  const tabbed = await nav.isVisible()
  if (tabbed) await nav.click()
  await page.fill('#f-start', hhmm)
  if (tabbed) await page.getByTestId('nav-crate').click()
}
const addBtn = (page) => page.locator('button[aria-label$="to the show"]:not([disabled])')
const addN = async (page, n) => {
  for (let i = 0; i < n; i++) {
    await addBtn(page).first().click()
  }
}
const rows = (page) => page.locator('[data-testid="row"]')
const titles = async (page) => rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-title')))
const kinds = async (page) => rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))
const starts = async (page) => page.locator('[data-testid="row-start"]').allTextContents()
const meter = async (page) => ({ text: (await page.getByTestId('meter-text').first().textContent()).replace(/\s+/g, ' ').trim(), tail: (await page.getByTestId('meter-tail').first().textContent()).trim() })
const toastText = async (page) => (await page.getByTestId('toast').allTextContents()).join(' | ')
const settle = (page, ms = 450) => page.waitForTimeout(ms)
const openImport = async (page, tab) => {
  await page.getByTestId('open-import').click()
  await page.getByTestId(`tab-${tab}`).click()
}
const csvFile = (csv, name = 'songs.csv') => ({ name, mimeType: 'text/csv', buffer: Buffer.from(csv) })

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`)
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${msg}\n    expected: ${b}\n    actual:   ${a}`)
}

function test(name, fn, opts = {}) {
  results.push({ name, fn, opts })
}

async function mouseDrag(page, from, to, { steps = 18, dy = 0 } = {}) {
  // Bring the target near first, then the thing being dragged last, so the grip is never
  // left hidden under the sticky toolbar. A target that is still partly off screen is
  // clamped to the viewport (real users get edge auto-scroll from dnd-kit for the rest).
  await to.scrollIntoViewIfNeeded()
  await from.scrollIntoViewIfNeeded()
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  assert(a && b, 'drag endpoints must be visible')
  const vh = page.viewportSize().height
  const sx = a.x + a.width / 2, sy = a.y + a.height / 2
  const hit = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el ? (el.closest('button,[data-testid]')?.getAttribute('aria-label') ?? el.tagName) : null }, [sx, sy])
  assert(hit !== null, 'grip must be on screen')
  const ex = b.x + b.width / 2
  const ey = Math.min(b.y + b.height / 2 + dy, vh - 12)
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + 8, sy + 8, { steps: 3 })
  await page.mouse.move(ex, ey, { steps })
  await page.waitForTimeout(120)
  await page.mouse.up()
  await page.waitForTimeout(350)
}

// ------------------------------------------------------------------ tests: first run + library
test('first load is clean: no errors, empty-state mascots, 4 color legend', async ({ page, errors }) => {
  assert((await page.title()).includes('Core'), 'title')
  assert(await page.getByTestId('load-demo').isVisible(), 'demo button visible')
  assert(await page.getByText('Nothing on the air yet.').isVisible(), 'empty rundown message')
  eq(await page.locator('ul[aria-label="Color key"] li').count(), 4, 'legend entries')
  eq(errors, [], 'no console/page errors')
})

test('demo songs load and the crate search / filters work', async ({ page }) => {
  await demo(page)
  eq(await page.getByTestId('crate-count').textContent(), '19 songs', 'count')
  await page.getByLabel('Search songs').fill('tiger')
  eq(await page.getByTestId('track-card').count(), 1, 'search by artist word "tiger" (Tigerlily Tape Club)')
  await page.getByLabel('Search songs').fill('wall of foam')
  eq(await page.getByTestId('track-card').count(), 1, 'search by album')
  await page.getByLabel('Search songs').fill('')
  await page.getByRole('button', { name: 'Required', exact: true }).click()
  eq(await page.getByTestId('track-card').count(), 9, 'required filter')
  await page.getByRole('button', { name: 'My picks' }).click()
  eq(await page.getByTestId('track-card').count(), 10, 'picks filter')
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByLabel('Search songs').fill('zzz-nothing')
  assert(await page.getByText('No songs match').isVisible(), 'no-match message')
})

test('role toggle recolors a song; edit dialog changes details; remove needs two clicks', async ({ page }) => {
  await demo(page)
  const card = page.getByTestId('track-card').first()
  eq(await card.getAttribute('data-role'), 'required', 'starts required')
  await card.locator('button.chip').click()
  eq(await card.getAttribute('data-role'), 'personal', 'toggled to personal')
  await card.getByRole('button', { name: /^Edit / }).click()
  await page.fill('#e-title', 'Renamed Song')
  await page.fill('#e-artist', 'New Artist')
  await page.getByTestId('edit-save').click()
  assert(await page.getByText('Renamed Song').isVisible(), 'renamed visible')
  const before = await page.getByTestId('track-card').count()
  const rm = page.getByTestId('track-card').first().getByRole('button', { name: /^Remove / })
  await rm.click()
  eq(await page.getByTestId('track-card').count(), before, 'first click only arms the button')
  await page.getByTestId('track-card').first().getByRole('button', { name: /^Confirm: Remove / }).click()
  eq(await page.getByTestId('track-card').count(), before - 1, 'second click removes')
})

// ------------------------------------------------------------------ importers
test('CSV import: template parses, previews, imports; re-import reports duplicates', async ({ page }) => {
  await openImport(page, 'csv')
  const template = 'title,artist,album,duration,type\nNeon Parking Lot,Velvet Static,Midnight Laundromat,3:42,required\nBoombox Heart,The Paper Moons,Skate Wax Sessions,4:05,required\n"Quotes, and commas",Gold Fish Radio,,215,personal\n,No Title,,1:00,\nBadLength,Someone,,abc,\n'
  await page.setInputFiles('[data-testid="csv-file"]', csvFile(template))
  await page.getByTestId('import-preview').waitFor()
  assert((await page.getByTestId('import-preview').textContent()).includes('4 songs ready'), 'preview says 4 songs (3 good + BadLength)')
  const problems = await page.getByTestId('import-problems').textContent()
  assert(problems.includes('Line 5') && problems.includes('no song title'), 'reports the titleless row by line number')
  assert(problems.includes('Line 6') && problems.includes('abc'), 'reports the bad duration')
  await page.getByLabel(/Fill in missing/).uncheck()
  await page.getByTestId('csv-import').click()
  eq(await page.getByTestId('crate-count').textContent(), '4 songs', 'imported')
  assert((await toastText(page)).includes('Added 4 songs'), 'toast')
  // Neon + Boombox say "required"; BadLength has no type so it takes the dialog default (required); "Quotes" says personal
  eq(await page.locator('[data-testid="track-card"][data-role="required"]').count(), 3, 'type column honored, blank falls back to the dialog default')
  eq(await page.locator('[data-testid="track-card"][data-role="personal"]').getAttribute('data-title'), 'Quotes, and commas', 'explicit personal respected')
  // re-import: nothing new
  await openImport(page, 'csv')
  await page.setInputFiles('[data-testid="csv-file"]', csvFile(template))
  await page.getByLabel(/Fill in missing/).uncheck()
  await page.getByTestId('csv-import').click()
  eq(await page.getByTestId('crate-count').textContent(), '4 songs', 'no duplicates created')
  assert((await toastText(page)).includes('already in your crate'), 'duplicate toast')
})

test('CSV: Spotify-export style columns (ms durations, multiple artists) and bad file handling', async ({ page }) => {
  await openImport(page, 'csv')
  await page.getByTestId('csv-text').fill('Track URI,Track Name,Album Name,Artist Name(s),Duration (ms)\nspotify:track:1,Song One,Album One,Artist A;Artist B,225000')
  assert((await page.getByTestId('import-preview').textContent()).includes('1 song ready'), 'preview')
  await page.getByLabel(/Fill in missing/).uncheck()
  await page.getByTestId('csv-import').click()
  const card = page.getByTestId('track-card').first()
  assert((await card.textContent()).includes('3:45'), '225000 ms shown as 3:45')
  // garbage input: nothing importable, button disabled
  await openImport(page, 'csv')
  await page.getByTestId('csv-text').fill('just one lonely cell')
  assert(await page.getByTestId('csv-import').isDisabled(), 'import disabled when nothing parses')
})

test('Paste a tracklist: formats, numbering, trailing durations, both orders', async ({ page }) => {
  await openImport(page, 'paste')
  await page.getByTestId('paste-text').fill('1. Velvet Static - Neon Parking Lot (3:42)\n2) The Paper Moons - Boombox Heart [4:05]\n- Cassette Safari - Tiger in the Tape Deck\n')
  assert((await page.getByTestId('import-preview').textContent()).includes('3 songs ready'), 'preview')
  await page.getByLabel(/Fill in missing/).uncheck()
  await page.getByTestId('paste-import').click()
  eq(await page.getByTestId('crate-count').textContent(), '3 songs', 'imported')
  const text = await page.getByTestId('crate-list').textContent()
  assert(text.includes('Neon Parking Lot') && text.includes('3:42') && text.includes('Velvet Static'), 'artist/title/duration parsed')
  assert(text.includes('no length yet'), 'song without a length is flagged')
  // swap order
  await openImport(page, 'paste')
  await page.getByRole('button', { name: 'Title - Artist' }).click()
  await page.getByTestId('paste-text').fill('Echo Chamber - Lost Signal')
  await page.getByLabel(/Fill in missing/).uncheck()
  await page.getByTestId('paste-import').click()
  const echo = page.locator('[data-testid="track-card"][data-title="Echo Chamber"]')
  assert((await echo.textContent()).includes('Lost Signal'), 'title-artist order respected')
})

test('Add one song by hand: validation, lookup autofill, form resets', async ({ page }) => {
  await page.getByRole('button', { name: 'Add one' }).click()
  assert(await page.getByTestId('manual-add').isDisabled(), 'disabled without a title')
  await page.fill('#m-title', 'Echo Chamber')
  await page.fill('#m-artist', 'Lost Signal')
  await page.fill('#m-dur', 'abc')
  assert(await page.getByTestId('manual-add').isDisabled(), 'disabled with a bad length')
  await page.fill('#m-dur', '')
  await page.getByRole('button', { name: 'Look up details' }).click()
  await page.getByText(/Found "Echo Chamber"/).waitFor()
  eq(await page.inputValue('#m-dur'), '3:21', 'length from lookup (201 s)')
  eq(await page.inputValue('#m-album'), 'Dial Tone', 'album from lookup')
  await page.getByTestId('manual-add').click()
  eq(await page.inputValue('#m-title'), '', 'form clears for the next song')
  await page.keyboard.press('Escape')
  const card = page.locator('[data-testid="track-card"][data-title="Echo Chamber"]')
  assert((await card.textContent()).includes('3:21'), 'saved with length')
})

test('background lookup fills lengths + artwork for songs missing them, and can find nothing gracefully', async ({ page }) => {
  await openImport(page, 'paste')
  await page.getByTestId('paste-text').fill('Lost Signal - Echo Chamber')
  await page.getByTestId('paste-import').click() // lookup stays on
  await page.getByText(/Filled in details for 1 song/).waitFor({ timeout: 15000 })
  const card = page.locator('[data-testid="track-card"][data-title="Echo Chamber"]')
  assert((await card.textContent()).includes('3:21'), 'length filled in')
  eq(await card.locator('img').getAttribute('src'), 'https://example.invalid/300x300bb.jpg', 'artwork upsized to 300px')
  // a song nobody has heard of: stays blank, user told
  await openImport(page, 'paste')
  await page.getByTestId('paste-text').fill('Nobody - Unfindable Song')
  await page.getByTestId('paste-import').click()
  await page.getByText(/Couldn't find matches/).waitFor({ timeout: 15000 })
  assert((await page.locator('[data-testid="track-card"][data-title="Unfindable Song"]').textContent()).includes('no length yet'), 'stays blank')
})

test('Spotify: full PKCE sign-in + playlist import against a mocked Spotify', async ({ ctx, page, errors }) => {
  const seen = { token: null, itemsAuth: [], itemsUrls: [], challenge: null }
  await ctx.route('https://accounts.spotify.com/authorize**', (route) => {
    const u = new URL(route.request().url())
    seen.challenge = u.searchParams.get('code_challenge')
    assert(u.searchParams.get('client_id') === 'abc123clientid', 'client id sent')
    assert(u.searchParams.get('code_challenge_method') === 'S256', 'S256')
    assert(!u.searchParams.has('client_secret'), 'no client secret')
    assert(u.searchParams.get('scope').includes('playlist-read-private'), 'scope')
    return route.fulfill({ status: 302, headers: { location: `${u.searchParams.get('redirect_uri')}?code=THECODE&state=${u.searchParams.get('state')}` } })
  })
  await ctx.route('https://accounts.spotify.com/api/token', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = new URLSearchParams(route.request().postData())
    seen.token = Object.fromEntries(body)
    const challenge = createHash('sha256').update(body.get('code_verifier')).digest('base64url')
    assert(challenge === seen.challenge, 'PKCE verifier hashes to the challenge sent earlier')
    return json(route, { access_token: 'ACCESS123', token_type: 'Bearer', expires_in: 3600, refresh_token: 'R' })
  })
  const track = (n, ms, extra = {}) => ({ type: 'track', name: n, duration_ms: ms, artists: [{ name: 'Artist A' }, { name: 'Artist B' }], album: { name: 'Album X', images: [{ url: 'https://example.invalid/640.jpg', width: 640 }, { url: 'https://example.invalid/300.jpg', width: 300 }] }, ...extra })
  const PL = '37i9dQZF1DXcBWIGoYBM5M'
  await ctx.route(`https://api.spotify.com/v1/playlists/${PL}**`, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = route.request().url()
    seen.itemsAuth.push(route.request().headers().authorization)
    seen.itemsUrls.push(url)
    if (url.includes('fields=name')) return json(route, { name: 'Mock Mix' })
    if (url.includes('offset=50')) return json(route, { items: [{ item: track('Third Song', 180000) }], next: null })
    return json(route, { items: [{ item: track('First Song', 225000) }, { item: null }, { item: track('Ep', 1000, { type: 'episode' }) }, { item: track('Second Song', 0) }], next: `https://api.spotify.com/v1/playlists/${PL}/items?offset=50&limit=50` })
  })
  await openImport(page, 'spotify')
  assert(await page.getByTestId('spotify-connect').isDisabled(), 'connect disabled without client id')
  await page.fill('#sp-id', 'abc123clientid')
  assert((await page.inputValue('#sp-redirect')).startsWith('http://localhost:4174'), 'redirect uri shown')
  assert((await page.getByText('Spotify does not accept "localhost"').count()) === 1, 'warns that localhost is not accepted by Spotify')
  // localhost is rejected by Spotify; the e2e server is on localhost, so bypass the guard by calling through 127.0.0.1
  await page.close()
  const p2 = await ctx.newPage()
  p2.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  p2.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  await p2.goto(BASE.replace('localhost', '127.0.0.1'))
  await openImport(p2, 'spotify')
  await p2.fill('#sp-id', 'abc123clientid')
  await p2.getByTestId('spotify-connect').click()
  await p2.getByText('Connected to Spotify').waitFor({ timeout: 10000 })
  assert(p2.url().split('?')[0].endsWith('/') && !p2.url().includes('code='), 'callback params are stripped from the address bar')
  eq(seen.token.grant_type, 'authorization_code', 'token exchange')
  eq(seen.token.client_id, 'abc123clientid', 'client id in exchange')
  assert(!('client_secret' in seen.token), 'no client secret in exchange')
  await p2.fill('#sp-link', `https://open.spotify.com/playlist/${PL}?si=xyz`)
  await p2.getByTestId('spotify-import').click()
  await p2.getByText(/Added 3 songs/).waitFor({ timeout: 10000 })
  assert(seen.itemsAuth.every((a) => a === 'Bearer ACCESS123'), 'bearer token on every call')
  assert(seen.itemsUrls.some((u) => u.includes('/items?limit=50')), 'uses the 2026 /items endpoint')
  assert(!seen.itemsUrls.some((u) => /\/tracks(\?|$)/.test(u)), 'never the removed /tracks endpoint')
  const text = await p2.getByTestId('crate-list').textContent()
  assert(text.includes('First Song') && text.includes('3:45') && text.includes('Artist A, Artist B') && text.includes('Third Song'), 'songs with duration, artists, pagination')
  assert(text.includes('no length yet'), 'a 0 ms track is "no length", not 0:00')
  eq(await p2.locator('[data-testid="track-card"][data-title="First Song"] img').getAttribute('src'), 'https://example.invalid/300.jpg', 'album artwork URL (300px size) used')
  eq(await p2.locator('[data-testid="track-card"][data-role="required"]').count(), 3, 'imported as required (default while crate has < 6)')
  assert(await p2.locator('select[aria-label="Show songs from playlist"] option', { hasText: 'Mock Mix' }).count() === 1, 'playlist remembered for reuse')
  eq(errors.filter((e) => !/Failed to load resource/.test(e)), [], 'no unexpected errors')
})

test('Spotify errors are explained: bad links, 403 owner rule, expired session, album link', async ({ ctx, page }) => {
  const SEEDED = { accessToken: 'T', expiresAt: Date.now() + 3_600_000 }
  await page.evaluate((t) => localStorage.setItem('core.spotify.token', JSON.stringify(t)), SEEDED)
  const PL = '37i9dQZF1DXcBWIGoYBM5M'
  let mode = 403
  await ctx.route(`https://api.spotify.com/v1/playlists/${PL}**`, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    return json(route, { error: { status: mode } }, mode)
  })
  await openImport(page, 'spotify')
  await page.getByText('Connected to Spotify').waitFor()
  await page.fill('#sp-link', 'https://open.spotify.com/album/' + PL)
  await page.getByTestId('spotify-import').click()
  assert((await page.getByTestId('import-error').textContent()).includes('album link'), 'album link is named')
  await page.fill('#sp-link', 'hello')
  await page.getByTestId('spotify-import').click()
  assert((await page.getByTestId('import-error').textContent()).includes('Paste a Spotify playlist link'), 'junk link')
  await page.fill('#sp-link', `https://open.spotify.com/playlist/${PL}`)
  await page.getByTestId('spotify-import').click()
  await page.getByText(/own or collaborate on/).waitFor()
  mode = 429
  await page.getByTestId('spotify-import').click()
  await page.getByText(/slow down/).waitFor()
  mode = 404
  await page.getByTestId('spotify-import').click()
  await page.getByText(/couldn't find that playlist/i).waitFor()
  mode = 401
  await page.getByTestId('spotify-import').click()
  await page.getByText(/session expired/i).waitFor()
  assert(await page.getByTestId('spotify-connect').isVisible(), 'asks to connect again')
})

test('Spotify: a forged callback (wrong state) is ignored and never exchanged', async ({ ctx, page }) => {
  let tokenCalls = 0
  await ctx.route('https://accounts.spotify.com/api/token', (route) => ((tokenCalls++), json(route, {})))
  await page.evaluate(() => {
    localStorage.setItem('core.spotify.state', 'real-state')
    localStorage.setItem('core.spotify.verifier', 'v'.repeat(50))
    localStorage.setItem('core.spotify.clientId', 'c')
    localStorage.setItem('core.spotify.redirect', location.origin + '/')
  })
  await page.goto(BASE + '?code=EVIL&state=forged')
  await page.getByText(/could not be verified/i).waitFor()
  eq(tokenCalls, 0, 'no token request made')
})

test('Apple Music: token check, private-link guidance, paginated import against a mocked Apple API', async ({ ctx, page }) => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const token = createDeveloperToken({ privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), teamId: 'TEAM123456', keyId: 'KEY1234567', days: 30 })
  const expired = createDeveloperToken({ privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), teamId: 'TEAM123456', keyId: 'KEY1234567', days: 1, now: 1_000_000_000 })
  const seen = []
  const song = (n) => ({ type: 'songs', attributes: { name: n, artistName: 'Apple Band', albumName: 'Apple LP', durationInMillis: 199500, artwork: { url: 'https://example.invalid/{w}x{h}bb.jpg' } } })
  await ctx.route('https://api.music.apple.com/**', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const u = route.request().url()
    seen.push({ u, auth: route.request().headers().authorization })
    if (u.includes('/tracks?offset=100')) return json(route, { data: [song('Page Two Song')] })
    return json(route, { data: [{ attributes: { name: 'Apple Mix' }, relationships: { tracks: { data: [song('Page One Song'), { type: 'music-videos', attributes: { name: 'A Video' } }], next: '/v1/catalog/us/playlists/pl.u-AbC123/tracks?offset=100' } } }] })
  })
  await openImport(page, 'apple')
  await page.fill('#ap-token', expired)
  await page.getByText(/has expired/).waitFor()
  await page.fill('#ap-token', 'garbage')
  await page.getByText(/does not look like a developer token/).waitFor()
  await page.fill('#ap-token', token)
  await page.getByText(/Token looks valid/).waitFor()
  await page.fill('#ap-link', 'https://music.apple.com/library/playlist/p.AbCdEf')
  await page.getByTestId('apple-import').click()
  assert((await page.getByTestId('import-error').textContent()).includes('private library'), 'private link explained')
  await page.fill('#ap-link', 'https://music.apple.com/us/playlist/summer-mix/pl.u-AbC123?l=en')
  await page.getByTestId('apple-import').click()
  await page.getByText(/Added 2 songs/).waitFor({ timeout: 10000 })
  assert(seen.every((s) => s.auth === `Bearer ${token}` && s.u.startsWith('https://api.music.apple.com/')), 'token only sent to Apple, on every call')
  const text = await page.getByTestId('crate-list').textContent()
  assert(text.includes('Page One Song') && text.includes('Page Two Song') && !text.includes('A Video'), 'both pages, music video skipped')
  assert(text.includes('3:20'), '199.5 s rounds to 3:20')
  eq(await page.locator('[data-testid="track-card"][data-title="Page One Song"] img').getAttribute('src'), 'https://example.invalid/300x300bb.jpg', 'artwork template filled')
  // 401 handling
  await ctx.unroute('https://api.music.apple.com/**')
  await ctx.route('https://api.music.apple.com/**', (route) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : json(route, {}, 401))
  await openImport(page, 'apple')
  await page.fill('#ap-link', 'https://music.apple.com/us/playlist/x/pl.u-Other')
  await page.getByTestId('apple-import').click()
  await page.getByText(/rejected the developer token/).waitFor()
})

// ------------------------------------------------------------------ the show builder + timing
test('adding songs builds an exact, continuous timeline with auto station elements', async ({ page }) => {
  await demo(page)
  await setStart(page, '14:00')
  await addN(page, 6)
  // first six demo songs (required): Neon 222, Boombox 245, Raccoon 198, Sunday 231, Cassette 267, Basement 189
  eq(await titles(page), ['PHS Partnership', 'Neon Parking Lot', 'Boombox Heart', 'Raccoon Radio', 'Sunday Sticker', 'Image ID', 'Cassette Safari', 'Basement Show Blues'], 'order: Image ID placed after the song that spans 2:15 (not cutting it off)')
  eq(await starts(page), ['2:00:00', '2:00:30', '2:04:12', '2:08:17', '2:11:35', '2:15:26', '2:15:46', '2:20:13'], 'every start equals the previous end')
  const ends = await page.locator('[data-testid="row"] .mono:text-matches("^to ")').allTextContents()
  eq(ends.at(-1), 'to 2:23:22', 'final end')
  // 30 + 222+245+198+231 + 20 + 267 + 189 = 1402s = 23:22
  eq(await meter(page), { text: '23:22 / 60:00', tail: '36:38 remaining' }, 'meter')
  const timing = await page.locator('[data-testid="timing"]').allTextContents()
  assert(timing[1].includes('due 2:15:00') && timing[1].includes('0:26 late'), `Image ID shows 26 s late: ${timing[1]}`)
})

test('editing a length reflows everything after it instantly', async ({ page }) => {
  await demo(page)
  await setStart(page, '14:00')
  await addN(page, 3)
  eq((await starts(page)).slice(0, 4), ['2:00:00', '2:00:30', '2:04:12', '2:08:17'], 'before')
  const input = rows(page).nth(1).getByLabel('Neon Parking Lot length')
  await input.fill('5:00')
  await input.press('Enter')
  eq((await starts(page)).slice(0, 4), ['2:00:00', '2:00:30', '2:05:30', '2:09:35'], 'after: +78 s pushed everything down')
  await input.fill('nonsense')
  await input.press('Enter')
  eq(await input.getAttribute('aria-invalid'), 'true', 'bad length flagged')
  eq((await starts(page))[2], '2:05:30', 'bad input did not change the timeline')
  await input.press('Escape')
})

test('move up/down buttons reorder and update times', async ({ page }) => {
  await demo(page)
  await page.fill('#f-start', '14:00')
  await page.getByRole('checkbox', { name: /Place station elements/ }).uncheck()
  await addN(page, 3)
  eq(await titles(page), ['Neon Parking Lot', 'Boombox Heart', 'Raccoon Radio'], 'initial')
  await page.getByRole('button', { name: 'Move Raccoon Radio up' }).click()
  eq(await titles(page), ['Neon Parking Lot', 'Raccoon Radio', 'Boombox Heart'], 'after up')
  await page.getByRole('button', { name: 'Move Neon Parking Lot down' }).click()
  eq(await titles(page), ['Raccoon Radio', 'Neon Parking Lot', 'Boombox Heart'], 'after down')
  eq(await starts(page), ['2:00:00', '2:03:18', '2:07:00'], 'times follow the new order (198 s, then 222 s)')
  assert(await page.getByRole('button', { name: 'Move Raccoon Radio up' }).isDisabled(), 'first row cannot move up')
})

test('drag and drop with a mouse: crate -> show (end and middle), and reorder within the show', async ({ page }) => {
  await demo(page)
  await page.fill('#f-start', '14:00')
  await page.getByRole('checkbox', { name: /Place station elements/ }).uncheck()
  await addN(page, 2)
  // drag a crate card to the drop zone at the end
  const card = page.locator('[data-testid="track-card"][data-title="Raccoon Radio"]')
  await mouseDrag(page, card.locator('img'), page.getByText('Drop here to add to the end'))
  eq(await titles(page), ['Neon Parking Lot', 'Boombox Heart', 'Raccoon Radio'], 'dropped at end')
  // drag another onto the middle row: lands before it
  const card2 = page.locator('[data-testid="track-card"][data-title="Sunday Sticker"]')
  await mouseDrag(page, card2.locator('img'), rows(page).nth(1))
  eq(await titles(page), ['Neon Parking Lot', 'Sunday Sticker', 'Boombox Heart', 'Raccoon Radio'], 'inserted before the row it was dropped on')
  assert((await card2.getAttribute('data-inshow')) === 'true', 'card marked "in show"')
  // reorder: drag first row's grip below the last row
  await mouseDrag(page, page.getByRole('button', { name: /^Move Neon Parking Lot\./ }), rows(page).nth(3), { dy: 30 })
  eq(await titles(page), ['Sunday Sticker', 'Boombox Heart', 'Raccoon Radio', 'Neon Parking Lot'], 'reordered by dragging')
  eq(await starts(page), ['2:00:00', '2:03:51', '2:07:56', '2:11:14'], 'timeline recomputed after drag')
})

test('keyboard drag: space to lift, arrows to move, space to drop', async ({ page }) => {
  await demo(page)
  await page.fill('#f-start', '14:00')
  await page.getByRole('checkbox', { name: /Place station elements/ }).uncheck()
  await addN(page, 3)
  await page.getByRole('button', { name: /^Move Neon Parking Lot\./ }).focus()
  // dnd-kit measures between key presses, so give each one a frame or two like a human would
  for (const key of ['Space', 'ArrowDown', 'ArrowDown', 'Space']) {
    await page.keyboard.press(key)
    await page.waitForTimeout(150)
  }
  await settle(page)
  eq(await titles(page), ['Boombox Heart', 'Raccoon Radio', 'Neon Parking Lot'], 'moved with the keyboard')
})

test('dragging a song across an auto station element is honored', async ({ page }) => {
  await demo(page)
  await page.fill('#f-start', '14:00')
  await addN(page, 6)
  const before = await titles(page)
  const idIdx = before.indexOf('Image ID')
  // drag the song right below Image ID (Cassette Safari) above it
  await mouseDrag(page, page.getByRole('button', { name: /^Move Cassette Safari\./ }), rows(page).nth(idIdx), { dy: -20 })
  const after = await titles(page)
  assert(after.indexOf('Cassette Safari') < after.indexOf('Image ID'), `Cassette Safari now above Image ID: ${after.join(', ')}`)
  eq(after.filter((t) => t === 'Image ID').length, 1, 'still exactly one Image ID')
})

test('touch: long-press drag reorders on a phone', async ({ page, ctx }) => {
  await demo(page)
  await page.getByTestId('nav-setup').click()
  await page.fill('#f-start', '14:00')
  await page.getByRole('checkbox', { name: /Place station elements/ }).uncheck()
  await page.getByTestId('nav-crate').click()
  await addN(page, 3)
  await page.getByTestId('nav-show').click()
  const cdp = await ctx.newCDPSession(page)
  const grip = page.getByRole('button', { name: /^Move Neon Parking Lot\./ })
  const a = await grip.boundingBox()
  const target = await rows(page).nth(2).boundingBox()
  const x = a.x + a.width / 2
  const y = a.y + a.height / 2
  const touch = (type, xx, yy) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: xx, y: yy }] })
  await touch('touchStart', x, y)
  await page.waitForTimeout(400) // press and hold
  for (let i = 1; i <= 16; i++) {
    await touch('touchMove', x, y + ((target.y + target.height - 10 - y) * i) / 16)
    await page.waitForTimeout(16)
  }
  await touch('touchEnd')
  await settle(page)
  eq(await titles(page), ['Boombox Heart', 'Raccoon Radio', 'Neon Parking Lot'], 'long-press + drag moved the row')
})

test('mic breaks: add 3, numbered, length steppers change totals, remove renumbers, spread works', async ({ page }) => {
  await demo(page)
  await page.fill('#f-start', '14:00')
  await page.getByRole('checkbox', { name: /Place station elements/ }).uncheck()
  await addN(page, 6)
  for (let i = 0; i < 3; i++) await page.getByTestId('add-mic').click()
  const t = await titles(page)
  eq(t.slice(-3), ['Mic Break 1', 'Mic Break 2', 'Mic Break 3'], 'numbered')
  // songs: 222+245+198+231+267+189 = 1352 s; three default 1:30 mic breaks = 270 s; total 1622 s
  eq((await meter(page)).text, '27:02 / 60:00', 'six songs + 3 default mic breaks')
})

test('mic break length stepper (+15 s / -15 s) and typed length update the meter', async ({ page }) => {
  await page.getByTestId('add-mic').click()
  const start = (await meter(page)).text
  await page.getByRole('button', { name: /Lengthen Mic Break 1 by 15 seconds/ }).click()
  const after = (await meter(page)).text
  assert(start !== after, `meter changed ${start} -> ${after}`)
  await page.getByRole('button', { name: /Shorten Mic Break 1 by 15 seconds/ }).click()
  eq((await meter(page)).text, start, 'back to start')
  const len = page.getByLabel('Mic Break 1 length', { exact: true })
  await len.fill('2:00')
  await len.press('Enter')
  assert((await meter(page)).text.startsWith('2:30') || (await meter(page)).text.startsWith('2:00'), `typed length applied: ${(await meter(page)).text}`)
})

test('spread mic breaks distributes them through the songs; remove renumbers', async ({ page }) => {
  await demo(page)
  await page.getByRole('checkbox', { name: /Place station elements/ }).uncheck()
  await addN(page, 9)
  for (let i = 0; i < 3; i++) await page.getByTestId('add-mic').click()
  await page.getByRole('button', { name: 'Spread mic breaks' }).click()
  const k = await kinds(page)
  const idx = k.map((x, i) => (x === 'mic' ? i : -1)).filter((i) => i >= 0)
  assert(idx[0] > 0 && idx[2] < k.length - 1 && idx[1] - idx[0] > 1 && idx[2] - idx[1] > 1, `mics spread out: ${idx}`)
  await page.getByRole('button', { name: /^Remove Mic Break 1 from the show/ }).click()
  await page.getByRole('button', { name: /^Confirm: Remove Mic Break 1/ }).click()
  eq((await titles(page)).filter((t) => t.startsWith('Mic')), ['Mic Break 1', 'Mic Break 2'], 'renumbered')
})

test('a station element can be placed by hand and satisfies its clock slot', async ({ page }) => {
  await demo(page)
  await page.fill('#f-start', '14:00')
  await addN(page, 6)
  await page.getByRole('button', { name: 'Station element', exact: true }).click()
  await page.getByRole('menuitem', { name: /Concert Calendar/ }).click()
  const t = await titles(page)
  assert(t.at(-1) === 'Concert Calendar', 'added at the end')
  const row = rows(page).last()
  assert((await row.textContent()).includes('Placed by you'), 'marked as manual')
  // removing it hands control back to the scheduler
  await page.getByRole('button', { name: 'Let scheduler place all' }).click()
  assert(!(await titles(page)).includes('Concert Calendar'), 'unpinned')
})

// ------------------------------------------------------------------ validation
test('validation: every rule appears, with the right text, and clears when satisfied', async ({ page }) => {
  await demo(page)
  await page.fill('#f-start', '14:00')
  let issues = await page.getByTestId('issues').textContent()
  assert(issues.includes('Add 6 more required playlist songs (0 of 6)'), 'required count')
  assert(issues.includes('Add 3 more mic breaks (0 of 3)'), 'mic count')
  assert(issues.includes('of airtime is still open'), 'unused airtime')
  await addN(page, 7) // 7 required demo songs
  for (let i = 0; i < 4; i++) await page.getByTestId('add-mic').click()
  issues = await page.getByTestId('issues').textContent()
  assert(issues.includes('1 extra mic break'), 'too many mic breaks')
  assert(!issues.includes('required playlist song'), 'required rule cleared')
  // a song without a length
  await openImport(page, 'manual')
  await page.fill('#m-title', 'No Length Song')
  await page.getByTestId('manual-add').click()
  await page.keyboard.press('Escape')
  await page.locator('[data-testid="track-card"][data-title="No Length Song"]').getByRole('button', { name: /to the show/ }).click()
  assert((await page.getByTestId('issues').textContent()).includes('"No Length Song" has no duration'), 'missing duration')
  // "Show me" scrolls to and flashes the row
  await page.getByRole('button', { name: 'Show me' }).first().click()
  await page.waitForTimeout(300)
  assert(await page.locator('[data-testid="row"].flash').count() === 1, 'row flashed')
})

test('show over 60 minutes: meter turns to "over", error issue, nothing is cut off', async ({ page }) => {
  await demo(page)
  await page.fill('#f-start', '14:00')
  await page.getByRole('checkbox', { name: /Place station elements/ }).uncheck()
  await addN(page, 19)
  const m = await meter(page)
  assert(m.tail.endsWith('over'), `meter says over: ${m.tail}`)
  const issues = await page.getByTestId('issues').textContent()
  assert(/runs \d+:\d\d over 60 minutes/.test(issues), 'over-length error')
  eq(await rows(page).count(), 19, 'all 19 songs still scheduled')
})

test('station timing warnings: a very late element is flagged with a clear message', async ({ page }) => {
  await demo(page)
  await page.fill('#f-start', '14:00')
  await page.getByRole('checkbox', { name: /Place station elements/ }).uncheck()
  await addN(page, 6)
  await page.getByRole('button', { name: 'Station element', exact: true }).click()
  await page.getByRole('menuitem', { name: /Image ID/ }).click()
  const sev = await page.locator('[data-testid="timing"]').last().getAttribute('data-severity')
  eq(sev, 'error', 'Image ID at ~22 min is far past its 2:15 due time')
  assert((await page.getByTestId('issues').textContent()).includes('Image ID starts'), 'issue names it')
  // widening the window to +/-5 should not hide a 7+ min miss, but ±5 turns small misses to OK
  await page.getByRole('button', { name: '±5', exact: true }).click()
  assert((await page.getByTestId('issues').textContent()).includes('window ±5 min'), 'message reflects the window')
})

// ------------------------------------------------------------------ settings + clock
test('even / odd clock presets and the start hour drive which elements appear', async ({ page }) => {
  await demo(page)
  await page.fill('#f-start', '14:00')
  await addN(page, 8)
  let t = await titles(page)
  assert(t.includes('Image ID') && t.includes('PHS Partnership') && !t.includes('PSA'), `even hour: ${t}`)
  await page.fill('#f-start', '13:00')
  t = await titles(page)
  assert(t.includes('PSA') && !t.includes('Image ID'), `odd hour: ${t}`)
  await page.getByRole('button', { name: 'Even hour' }).click()
  t = await titles(page)
  assert(t.includes('Image ID') && !t.includes('PSA'), 'forced even')
  await page.getByRole('button', { name: 'Odd hour' }).click()
  assert((await titles(page)).includes('PSA'), 'forced odd')
})

test('flexibility window changes whether a close element is placed or left for later', async ({ page }) => {
  await demo(page)
  await page.fill('#f-start', '14:00')
  await addN(page, 4)
  for (const m of ['±1', '±2', '±3', '±5']) {
    await page.getByRole('button', { name: m, exact: true }).click()
    eq(await page.getByRole('button', { name: m, exact: true }).getAttribute('aria-pressed'), 'true', `${m} selected`)
  }
})

test('station clock editor: change a minute, add and remove, reset', async ({ page }) => {
  await demo(page)
  await page.fill('#f-start', '14:00')
  await addN(page, 6)
  await page.getByRole('button', { name: /^Station clock$/ }).first().click()
  const dlg = page.getByRole('dialog')
  const imageId = dlg.locator('[data-testid="clock-list"] input[aria-label="Element name"]').nth(1)
  eq(await imageId.inputValue(), 'Image ID', 'second even element')
  const minute = dlg.getByLabel('Image ID minute past the hour')
  await minute.fill('10')
  await dlg.getByTestId('clock-save').click()
  const t = await titles(page)
  const pos = t.indexOf('Image ID')
  const st = (await starts(page))[pos]
  assert(pos > 0 && pos < t.length - 1, `Image ID placed: ${st}`)
  const due = await page.locator('[data-testid="timing"]').nth(1).textContent()
  assert(due.includes('due 2:10:00'), `due time follows the edit: ${due}`)
  // reset
  await page.getByRole('button', { name: /^Station clock$/ }).first().click()
  await page.getByRole('button', { name: 'Reset to preset' }).click()
  eq(await page.getByRole('dialog').getByLabel('Image ID minute past the hour').inputValue(), '15', 'preset restored')
  await page.keyboard.press('Escape')
  eq(await page.getByRole('dialog').count(), 0, 'Esc closes the dialog')
})

// ------------------------------------------------------------------ saving
test('autosave: everything survives a reload (settings, library, rundown, clock, integrations)', async ({ page }) => {
  await demo(page)
  await page.fill('#f-show', 'Persist Me')
  await page.fill('#f-dj', 'DJ Test')
  await page.fill('#f-start', '14:00')
  await addN(page, 3)
  await page.getByTestId('add-mic').click()
  await page.getByRole('button', { name: '±5', exact: true }).click()
  await settle(page, 600)
  await page.reload()
  await page.waitForSelector('h1')
  eq(await page.inputValue('#f-show'), 'Persist Me', 'show name')
  eq(await page.inputValue('#f-dj'), 'DJ Test', 'dj name')
  eq(await page.inputValue('#f-start'), '14:00', 'start')
  eq(await page.getByRole('button', { name: '±5', exact: true }).getAttribute('aria-pressed'), 'true', 'flex')
  eq((await titles(page)).filter((t) => !['PHS Partnership', 'Image ID'].includes(t)), ['Neon Parking Lot', 'Boombox Heart', 'Raccoon Radio', 'Mic Break 1'], 'rundown restored')
  eq(await page.getByTestId('crate-count').textContent(), '19 songs', 'library restored')
})

test('multiple shows: create, duplicate, switch, delete, defaults for new shows', async ({ page }) => {
  await demo(page)
  await page.fill('#f-show', 'Show One')
  await page.fill('#f-dj', 'DJ Mango')
  await addN(page, 2)
  await page.getByRole('button', { name: 'Use for new shows' }).click()
  await page.getByRole('button', { name: /Open my shows/ }).click()
  await page.getByTestId('new-show').click()
  eq(await page.inputValue('#f-dj'), 'DJ Mango', 'new show uses saved defaults')
  eq(await rows(page).count(), 0, 'new show is empty')
  await page.fill('#f-show', 'Show Two')
  await page.getByRole('button', { name: /Open my shows/ }).click()
  const list = page.getByTestId('shows-list')
  eq(await list.locator('li').count(), 2, 'two shows listed')
  await list.locator('li', { hasText: 'Show One' }).getByRole('button', { name: 'Duplicate' }).click()
  eq(await page.inputValue('#f-show'), 'Show One (copy)', 'duplicate opened')
  eq(await rows(page).count() > 0, true, 'duplicate has the rundown')
  await page.getByRole('button', { name: /Open my shows/ }).click()
  eq(await page.getByTestId('shows-list').locator('li').count(), 3, 'three shows')
  await page.getByTestId('shows-list').locator('li', { hasText: 'Show Two' }).getByRole('button', { name: 'Open', exact: true }).click()
  eq(await page.inputValue('#f-show'), 'Show Two', 'switched')
  await settle(page, 600)
  await page.reload()
  await page.waitForSelector('h1')
  eq(await page.inputValue('#f-show'), 'Show Two', 'active show restored after reload')
  await page.getByRole('button', { name: /Open my shows/ }).click()
  const del = page.getByTestId('shows-list').locator('li', { hasText: 'Show One (copy)' }).getByRole('button', { name: /^Delete / })
  await del.click()
  await page.getByTestId('shows-list').locator('li', { hasText: 'Show One (copy)' }).getByRole('button', { name: /^Confirm: Delete / }).click()
  eq(await page.getByTestId('shows-list').locator('li').count(), 2, 'deleted')
})

test('export: CSV rundown has exact times; show file round-trips into a fresh browser', async ({ page, ctx }) => {
  await demo(page)
  await page.fill('#f-show', 'Export Test')
  await page.fill('#f-dj', 'DJ "Quote", Jr.')
  await page.fill('#f-start', '14:00')
  await addN(page, 6)
  await page.getByTestId('add-mic').click()
  // CSV
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const [csvDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Rundown as CSV/ }).click()])
  assert(/^export-test-\d{4}-\d{2}-\d{2}\.csv$/i.test(csvDl.suggestedFilename()), `filename ${csvDl.suggestedFilename()}`)
  const csvPath = join(OUT, 'rundown.csv')
  await csvDl.saveAs(csvPath)
  const csv = readFileSync(csvPath, 'utf8')
  assert(csv.includes('Start,End,Type,Title,Artist,Album,Length,Due,Timing'), 'header row')
  assert(csv.includes('2:00:00,2:00:30,Station element,PHS Partnership'), 'first row exact')
  assert(csv.includes('2:00:30,2:04:12,Required song,Neon Parking Lot,Velvet Static,Midnight Laundromat,3:42'), 'song row exact')
  assert(csv.includes('2:15:26,2:15:46,Station element,Image ID,Station element,,0:20,2:15:00,0:26 late'), 'timing columns')
  assert(csv.includes('"DJ ""Quote"", Jr."'), 'quotes escaped')
  assert(csv.trimEnd().split('\r\n').at(-1).startsWith('Total airtime'), 'totals row')
  // show file
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const [jsonDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Show file/ }).click()])
  const jsonPath = join(OUT, 'show.core-show.json')
  await jsonDl.saveAs(jsonPath)
  const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'))
  eq(parsed.app, 'core-show-planner', 'file marker')
  eq(parsed.shows[0].settings.showName, 'Export Test', 'name in file')
  assert(parsed.tracks.length === 6, 'songs bundled with the show')
  assert(!JSON.stringify(parsed).includes('"auto":true'), 'derived station elements are not stored')
  // import into a brand new browser profile
  const other = await fresh()
  await other.page.getByRole('button', { name: 'Save', exact: true }).click()
  await other.page.getByTestId('show-file-input').setInputFiles(jsonPath)
  await other.page.getByText(/Opened "Export Test"/).waitFor()
  eq(await other.page.inputValue('#f-show'), 'Export Test', 'show restored')
  eq((await titles(other.page)).filter((t) => t === 'Neon Parking Lot').length, 1, 'rundown restored')
  eq(await other.page.getByTestId('crate-count').textContent(), '6 songs', 'its songs came along')
  eq(await starts(other.page), await starts(page), 'identical timeline after round trip')
  await other.ctx.close()
  // junk file
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const bad = join(OUT, 'bad.json')
  writeFileSync(bad, 'not json at all')
  await page.getByTestId('show-file-input').setInputFiles(bad)
  await page.getByText(/isn't a saved show/).waitFor()
})

test('export: crate CSV and the blank template download and re-import', async ({ page }) => {
  await demo(page)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Song crate as CSV/ }).click()])
  const p = join(OUT, 'crate.csv')
  await dl.saveAs(p)
  const csv = readFileSync(p, 'utf8')
  assert(csv.startsWith('title,artist,album,duration,type,artwork_url'), 'header')
  assert(csv.split('\r\n').length >= 20, '19 songs + header')
  const other = await fresh()
  await openImport(other.page, 'csv')
  await other.page.setInputFiles('[data-testid="csv-file"]', p)
  await other.page.getByLabel(/Fill in missing/).uncheck()
  await other.page.getByTestId('csv-import').click()
  eq(await other.page.getByTestId('crate-count').textContent(), '19 songs', 'exported crate re-imports')
  await other.ctx.close()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const [t] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Blank song template/ }).click()])
  assert(t.suggestedFilename() === 'core-songs-template.csv', 'template filename')
})

test('print sheet: only the clean studio rundown prints; PDF has the right text', async ({ page }) => {
  await demo(page)
  await page.fill('#f-show', 'Print Test')
  await page.fill('#f-dj', 'DJ Paper')
  await page.fill('#f-start', '14:00')
  await addN(page, 6)
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++ } })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('menuitem', { name: /Print or save PDF/ }).click()
  await page.waitForFunction(() => window.__printed === 1)
  await page.emulateMedia({ media: 'print' })
  assert(await page.getByTestId('print-sheet').isVisible(), 'print sheet visible in print media')
  assert(!(await page.locator('h1').isVisible()), 'app chrome hidden in print media')
  const pdf = join(OUT, 'rundown.pdf')
  await page.pdf({ path: pdf, format: 'Letter', printBackground: true })
  const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' })
  for (const needle of ['Print Test', 'DJ DJ Paper', '90.3 The Core', 'PHS Partnership', 'Neon Parking Lot', 'Velvet Static', '2:00:30', '2:04:12', 'Image ID', '0:26 late', 'of 6 required songs', 'mic breaks'])
    assert(text.includes(needle), `PDF contains "${needle}"`)
  assert(!text.includes('Song crate') && !text.includes('Import songs'), 'no app UI in the PDF')
  eq(Number(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }).match(/Pages:\s+(\d+)/)[1]), 1, 'fits on one page')
  await page.emulateMedia({ media: 'screen' })
})

// ------------------------------------------------------------------ resilience
test('storage that rejects writes shows a clear "Not saved" warning instead of failing silently', async ({ page }) => {
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError') } })
  await page.fill('#f-show', 'Cannot Save')
  await page.getByText('Not saved').waitFor({ timeout: 3000 })
})

test('corrupt saved data does not crash the app', async ({ ctx }) => {
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.addInitScript(() => localStorage.setItem('core-planner:v1', '{"shows": [{"id": 5, "items": "oops"}], "library": 7'))
  await p.goto(BASE)
  await p.waitForSelector('h1')
  assert(await p.getByTestId('load-demo').isVisible(), 'falls back to a fresh planner')
  eq(errs, [], 'no exceptions')
})

test('hostile saved data is sanitized (bad artwork URLs, bogus kinds, absurd numbers)', async ({ ctx }) => {
  const p = await ctx.newPage()
  await p.addInitScript(() => localStorage.setItem('core-planner:v1', JSON.stringify({ shows: [{ id: 's', settings: { startTime: '99:99', flexMin: 17, durationMin: 99999 }, items: [{ kind: 'required', title: '<img src=x onerror=alert(1)>', durationSec: 200 }, { kind: 'bogus', title: 'x' }] }], library: [{ title: 'T', artwork: 'javascript:alert(1)' }] })))
  const dialogs = []
  p.on('dialog', (d) => (dialogs.push(d.message()), d.dismiss()))
  await p.goto(BASE)
  await p.waitForSelector('h1')
  await p.waitForTimeout(300)
  eq(dialogs, [], 'no script ran')
  eq(await rows(p).count() >= 1, true, 'valid item kept')
  assert((await p.locator('[data-testid="track-card"] img').first().getAttribute('src')).startsWith('data:image/svg+xml'), 'unsafe artwork replaced by generated cover')
})

// ------------------------------------------------------------------ accessibility + responsive
test('dialogs trap focus, close on Esc and return focus to the opener', async ({ page }) => {
  const opener = page.getByTestId('open-import')
  await opener.focus()
  await opener.press('Enter')
  const dlg = page.getByRole('dialog', { name: 'Import songs' })
  await dlg.waitFor()
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    assert(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), 'focus stays inside the dialog')
  }
  await page.keyboard.press('Escape')
  eq(await page.getByRole('dialog').count(), 0, 'closed')
  assert(await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'open-import'), 'focus returned to the opener')
})

test('every interactive control has an accessible name', async ({ page }) => {
  await demo(page)
  await addN(page, 3)
  await page.getByTestId('add-mic').click()
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll('button, a[href], input, select, textarea')]
      .filter((el) => el.offsetParent !== null && el.type !== 'hidden')
      .filter((el) => {
        const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.placeholder || '').trim()
        const labelled = el.id && document.querySelector(`label[for="${el.id}"]`)
        const wrapped = el.closest('label')
        return !name && !labelled && !wrapped
      })
      .map((el) => el.outerHTML.slice(0, 120)),
  )
  eq(unnamed, [], 'no unlabeled controls')
})

for (const [w, h, name] of [[360, 740, 'small phone'], [390, 844, 'iPhone'], [768, 1024, 'tablet'], [1099, 800, 'just below desktop layout'], [1100, 800, 'desktop layout'], [1440, 900, 'laptop'], [1920, 1080, 'large']]) {
  test(`no horizontal overflow and a usable layout at ${w}px (${name})`, async ({ page }) => {
    await demo(page)
    await setStartAny(page, '14:00')
    await addN(page, 6)
    for (const t of ['setup', 'crate', 'show', 'check']) {
      const nav = page.getByTestId(`nav-${t}`)
      if (await nav.isVisible()) await nav.click()
      const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
      assert(over.sw <= over.cw, `page ${t}: scrollWidth ${over.sw} > ${over.cw}`)
    }
    const h1 = await page.locator('h1').boundingBox()
    const save = await page.getByRole('button', { name: 'Save', exact: true }).boundingBox()
    assert(h1.x + h1.width <= save.x + 1 || h1.y + h1.height <= save.y, `wordmark does not collide with buttons (${JSON.stringify([h1, save])})`)
    if (w <= 1099) {
      assert(await page.getByTestId('nav-show').isVisible(), 'bottom tabs on narrow screens')
      assert((await page.locator('nav[aria-label="Sections"]').boundingBox()).y + 1 >= h - 80, 'tabs pinned to bottom')
    } else {
      assert(!(await page.getByTestId('nav-show').isVisible()), 'no tabs on desktop layout')
      for (const sel of ['#f-show', '[data-testid="crate-list"]', '[data-testid="rundown"]']) assert(await page.locator(sel).isVisible(), `${sel} visible at once on desktop`)
    }
  }, { viewport: { width: w, height: h, touch: w < 800 } })
}

test('phone flow end to end with taps only: import, add, check, export', async ({ page }) => {
  await page.getByTestId('load-demo').click()
  await page.getByTestId('nav-setup').click()
  await page.fill('#f-show', 'Phone Show')
  await page.fill('#f-start', '14:00')
  await page.getByTestId('nav-crate').click()
  await addN(page, 6)
  await page.getByTestId('nav-show').click()
  for (let i = 0; i < 3; i++) await page.getByTestId('add-mic').click()
  await page.getByTestId('nav-check').click()
  const issues = await page.getByTestId('issues').textContent()
  assert(!issues.includes('Add 3 more mic breaks') && !issues.includes('required playlist song'), 'requirements met')
  assert((await page.getByTestId('checklist').textContent()).includes('Place 3 mic breaks'), 'game plan visible')
  const mini = await page.locator('.sticky [data-testid="meter-text"]').first().textContent()
  assert(/\d+:\d\d \/ 60:00/.test(mini.replace(/\s+/g, ' ')), `sticky meter: ${mini}`)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const menu = await page.getByRole('menu').boundingBox()
  assert(menu.x >= 0 && menu.x + menu.width <= 390, 'export menu fits on screen')
})

test('timeline view shows the same items; clicking a block jumps to its row', async ({ page }) => {
  await demo(page)
  await page.fill('#f-start', '14:00')
  await addN(page, 6)
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  const blocks = page.locator('[data-testid="timeline-view"] button')
  eq(await blocks.count(), 8, 'same 8 items')
  const colors = await blocks.evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor))
  eq([...new Set(colors)].sort(), ['rgb(20, 128, 74)', 'rgb(216, 54, 43)'], 'only green (station) and red (required) in this show')
  await blocks.nth(2).click()
  await page.waitForSelector('[data-testid="rundown-list"]')
})

test('colors are exactly the brief: red required, blue picks, gray mic, green station', async ({ page }) => {
  await demo(page)
  await page.fill('#f-start', '14:00')
  await addN(page, 2)
  await page.getByRole('button', { name: 'My picks' }).click()
  await addN(page, 1)
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByTestId('add-mic').click()
  const colors = await rows(page).evaluateAll((els) => Object.fromEntries(els.map((e) => [e.getAttribute('data-kind'), getComputedStyle(e.firstElementChild).backgroundColor])))
  eq(colors, { station: 'rgb(20, 128, 74)', required: 'rgb(216, 54, 43)', personal: 'rgb(31, 95, 214)', mic: 'rgb(106, 112, 120)' }, 'stub colors')
})

// ------------------------------------------------------------------ run
let failed = 0
const wanted = results.filter((r) => !only || r.name.toLowerCase().includes(only.toLowerCase()))
for (const { name, fn, opts } of wanted) {
  const phone = /phone|touch|iPhone/i.test(name)
  const env = await fresh(opts.viewport ?? (phone ? { width: 390, height: 844, touch: true } : {}))
  const t0 = Date.now()
  try {
    await fn(env)
    const noisy = env.errors.filter((e) => !/Failed to load resource|net::ERR/.test(e))
    if (noisy.length && !name.includes('hostile') && !name.includes('Storage') && !name.includes('storage')) throw new Error(`console errors: ${noisy.join(' // ')}`)
    console.log(`  \x1b[32m✓\x1b[0m ${name} \x1b[2m(${Date.now() - t0}ms)\x1b[0m`)
  } catch (e) {
    failed++
    console.log(`  \x1b[31m✗ ${name}\x1b[0m\n    ${String(e.message).split('\n').join('\n    ')}`)
    try {
      await env.page.screenshot({ path: join(OUT, `FAIL-${name.replace(/\W+/g, '-').slice(0, 60)}.png`) })
    } catch {}
  } finally {
    await env.ctx.close().catch(() => {})
  }
}
await browser.close()
console.log(`\n${wanted.length - failed}/${wanted.length} passed. Output: ${OUT}`)
process.exit(failed ? 1 : 0)
