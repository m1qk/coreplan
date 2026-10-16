# 90.3 The Core: Show Planner (Aero 95 edition)

Same app and same features as the original, restyled as Windows 95 windows with light Frutiger Aero touches (glass title bars, glossy buttons, sky desktop). Only the look changed: the scheduling code, importers, tests and setup steps below are identical. Deploy it as its own site so the original stays online.

A planner for one-hour college radio shows at 90.3 The Core (WVPH, Rutgers). Import songs, drag them into an hour, and watch exact start and end times update as you go. Station elements (PHS Partnership, Image ID, promos and so on) are placed on the station clock automatically, and the app tells you plainly what still needs fixing.

It is a static website. There is no server and no account. Everything is saved in your own browser.

React 19, TypeScript, Tailwind CSS v4, Vite, @dnd-kit.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 125 unit tests (scheduler, CSV, importers, storage)
npm run build        # type-check + production build into dist/
npm run build:single # one self-contained HTML file in dist-single/
npm run preview      # serve dist/ at http://localhost:4173
npm run e2e          # 49 real-browser tests (needs a built dist/ and `npm run preview` running)
```

The e2e suite drives real Chromium through Playwright (`playwright-core`). It expects Chromium at the path in `e2e/run.mjs`; set the `CHROME` environment variable if yours lives elsewhere. Spotify, Apple Music and iTunes calls are mocked in those tests (see "What is and is not verified" below).

## The seven steps (what the DJ does)

1. **Show details.** Name, DJ, date, start time, length (default 60), even or odd station clock, flexibility (±1, 2, 3, 5 minutes).
2. **Import songs.** Spotify, Apple Music, CSV, pasted tracklist, or add one by hand. Mark them Required (red) or My picks (blue).
3. **Build the hour.** Drag songs from the crate into the rundown, or tap **+**. Reorder by dragging a grip, by arrow buttons, or by keyboard (Space, arrows, Space).
4. **Add mic breaks.** Exactly three are needed. Change their length with the steppers. **Spread mic breaks** spaces them through the music.
5. **Check the clock.** Station elements are placed in the nearest gap, never in the middle of a song. Each one shows how far from its due time it landed.
6. **Fix what the checker says.** Fewer than 6 required songs, wrong number of mic breaks, late announcements, over an hour, too much dead air, songs with no length.
7. **Save or print.** Autosave is always on. Export the rundown as CSV, print or save a PDF, or save a show file.

Colors are fixed and every item also carries a text tag, so color is never the only signal:

| Color | Meaning |
| --- | --- |
| Red | Required station playlist song |
| Blue | DJ-selected song |
| Gray | Mic break |
| Green | Station element (ID, promo, PSA, calendar) |

## Station clock: please confirm with the station

The clock photo shows which elements belong to even and odd hours and their order around the dial. It does **not** show minute marks or lengths. These are the defaults I used, read like a wall clock (top is :00, right is :15, bottom is :30, left is :45):

| | :00 | :15 | :30 | :45 |
| --- | --- | --- | --- | --- |
| Even hours | PHS Partnership | Image ID | Community Calendar | Station Promo |
| Odd hours | PHS Partnership | PSA | Concert Calendar | DJ Promo |

Lengths default to 0:30 (Image ID 0:20). All of this is editable in the app under **Station clock** and is saved per browser. If the real minutes or lengths differ, change them there, or edit `src/lib/clock.ts` to change the defaults for everyone.

## Importing songs

### CSV (works everywhere, no setup)

Use **Import songs > CSV file** and download the blank template, or export your crate from the Save menu. Columns (names are matched loosely, order does not matter):

`Title, Artist, Album, Duration, Type, Artwork`

- Duration can be `3:42`, `3m42s`, `222` (seconds) or milliseconds from Exportify-style files.
- Type can be `required` or `personal` (blank takes the choice in the dialog).
- Commas and quotes inside quoted cells are handled. Cells starting with `=`, `+`, `-` or `@` are neutralized on export so spreadsheets can't run them.
- Bad rows are skipped and listed with the reason, never silently dropped.

### Paste a list

One song per line: `Artist - Title (3:45)` or `Title - Artist` (you choose which order in the dialog), with optional numbering like `1.`. Tab-separated `Title, Artist, Album, Length` also works, so you can paste straight from a spreadsheet. Good for copying out of an email or a doc.

### Spotify playlist URL

Needs a one-time setup because Spotify requires every app to be registered. The app uses the official Web API with **Authorization Code + PKCE**, so there is **no client secret** anywhere and nothing sensitive is stored.

1. Go to <https://developer.spotify.com/dashboard> and sign in. Choose **Create app**.
2. Name it anything. Under **Redirect URIs** add the exact address of the page you'll use the planner from, including the trailing slash, for example `https://yourname.github.io/core-planner/`. For local testing use `http://127.0.0.1:4173/` after `npm run build && npm run preview -- --host 127.0.0.1` (Spotify rejects `localhost`, but allows `http://127.0.0.1`, so no hosting is needed to try it).
3. Tick **Web API** and save. Copy the **Client ID** from the app's settings.
4. In the planner choose **Import songs > Spotify**, paste the Client ID, and press **Connect Spotify**. Approve the screen. You're sent back and can paste a playlist link.

Limits you should know about, because they are Spotify's rules, not the planner's:

- Apps in Development Mode only work for people on the app's user allowlist (**Settings > User management**, up to 25 people). The app owner needs Spotify Premium.
- Spotify only lets an app read playlists **you own or collaborate on**. Someone else's public playlist will return "forbidden". Workaround: in Spotify, add the playlist to your own (select all, copy, paste into a new playlist you own), or use the CSV route.
- The Client ID and redirect URI are stored in your browser so you don't retype them. Access tokens live in memory only.

### Apple Music playlist URL

Apple requires a signed **developer token**. The private key must never go in a website, so the token is made on your computer with a script and pasted into the app.

1. Join the Apple Developer Program (paid, yearly).
2. In the developer portal create a **Media ID** and a **MusicKit private key** (a `.p8` file). Note your **Team ID** and the key's **Key ID**.
3. On your computer run:

   ```bash
   npm run apple-token -- --key AuthKey_XXXXXXXXXX.p8 --team YOUR_TEAM_ID --kid YOUR_KEY_ID
   ```

   It prints a token valid for 90 days (`--days N`, Apple's maximum is about six months).
4. In the planner choose **Import songs > Apple Music**, paste the token, choose your storefront, and paste a **public** playlist link (`music.apple.com/.../pl.xxxx`).

Limits: only public catalog playlists (`pl.` ids) are supported. Private library playlists (`p.` ids) need per-user MusicKit sign-in, which is **not implemented**. The token is only ever sent to `api.music.apple.com`.

### Lengths and artwork

If an import lacks lengths or artwork, **Find lengths and artwork** looks songs up through the free iTunes Search API (no key, rate-limited to about 20 requests a minute, so it runs slowly in the background and can be cancelled). Songs with no length count as 0:00 and are flagged until you fill them in.

## Deploying

The build is plain static files, so any static host works.

```bash
npm run build        # upload the contents of dist/
```

Options:

- **GitHub Pages:** the repo includes `.github/workflows/pages.yml`. Push to `main`, then set Settings > Pages > Source to "GitHub Actions". Your address will be `https://USERNAME.github.io/REPO/`.
- **Netlify Drop (fastest, no account setup for a trial):** drag the built `dist/` folder onto <https://app.netlify.com/drop>. You get an https address immediately. The build uses relative asset paths (`base: './'`) so it works under `/repo-name/`.
- **Netlify / Cloudflare Pages / Vercel:** build command `npm run build`, publish directory `dist`.
- **University or station web space:** upload everything inside `dist/`.
- **One file:** `npm run build:single` makes `dist-single/index.html` you can email or open from disk. Everything except Spotify sign-in works from a file. Spotify needs a real `https://` address (or `127.0.0.1`) to redirect back to.

After deploying, add the final page address to the Spotify app's Redirect URIs (exact match, with trailing slash).

## Saving and exporting

- **Autosave** to this browser on every change (short debounce, flushed when you close or switch away). If the browser blocks storage (private window, full disk) a red **Not saved** badge appears.
- Browser storage belongs to one browser on one device. To move a show, use **Save > Show file (.json)** and **Open a show file** on the other device.
- **My shows** lets you create, duplicate, rename, switch and delete shows. **Use for new shows** stores your DJ name, start time and flexibility as defaults.
- **Rundown CSV** has exact start and end times for every row.
- **Print or save PDF** opens a clean black-on-white studio rundown. Choose "Save as PDF" as the printer.

## How scheduling works

The logic is in `src/lib/scheduler.ts` with no UI code mixed in, and it is unit tested (`scheduler.test.ts`).

- Playback is continuous. Each item starts exactly when the previous one ends.
- Station elements are due on the clock (:00, :15, :30, :45 by default) but are **never** placed inside a song. A pending element goes at the nearest boundary between items. If two boundaries are equally near, the later one wins (let the song finish).
- Within the flexibility window an element is "on time". Up to twice the window is a warning. Beyond that is an error.
- Elements you place by hand are kept where you put them and satisfy their slot. Auto-placed ones are recalculated every time, so they follow the music as you rearrange.
- A show with nothing in it places nothing. An hour that runs over is shown honestly (nothing is cut off) with an error.

## What is and is not verified

**Verified**
- 125 unit tests: time parsing, scheduling (overlaps, flexibility, shows over 60 minutes, parity), CSV edge cases, PKCE against the RFC 7636 test vector, an Apple developer token verified with a real ES256 signature check, persistence and sanitizing.
- 49 end-to-end tests in real Chromium: imports, drag and drop with mouse, keyboard and touch, mic breaks, validation messages, even/odd clocks, autosave across reloads, multiple shows, CSV and show-file round trips, print sheet and a generated PDF, broken or hostile saved data, focus trapping, accessible names, layouts from 360 px to 1920 px with no horizontal overflow, and the color rules.

**Not verified, so don't assume it works**
- **Live Spotify and Apple Music calls.** I had no credentials and the build environment only allows package registries, so those flows are tested against mocks that follow the documented API shapes. The first real run with your own Client ID or token is the real test. If something is off, the CSV and paste routes are unaffected.
- **thecore.fm and the DJ-only portal** were not used. Nothing here depends on them. Branding is original, not copied from the site.
- Real iPhone Safari. Touch drag was tested with emulated touch events in Chromium, not on a physical device.

**Not implemented**
- Spotify playlists you don't own or collaborate on (Spotify blocks this).
- Apple Music private library playlists.
- Sharing a show between DJs live. Shows move by file.
- Direct PDF download. PDF goes through the browser's print dialog.
- Dragging from the crate onto the rundown on phones and small tablets, where the crate and rundown are on separate tabs. Use the **+** button there. Reordering by dragging a grip works everywhere.

## Project layout

```
src/lib/        scheduler, clock presets, validation, CSV, importers, storage, store (all unit tested)
src/components/ UI (panels, dialogs, drag and drop, mascots)
e2e/run.mjs     the browser test suite
scripts/apple-token.mjs   makes the Apple developer token locally
```
