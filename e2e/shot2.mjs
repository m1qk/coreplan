import { chromium } from 'playwright-core'
const out = process.argv[2]
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
const errors = []
async function run(name, viewport, steps) {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 800 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto('http://localhost:4174/'); await page.waitForSelector('h1')
  await steps(page); await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/${name}.png` }); await ctx.close()
}
const fill = async (p) => {
  await p.getByTestId('load-demo').click()
  const tabbed = await p.getByTestId('nav-setup').isVisible()
  if (tabbed) { await p.getByTestId('nav-setup').click() }
  await p.fill('#f-start', '14:00')
  if (tabbed) await p.getByTestId('nav-crate').click()
  for (let i = 0; i < 9; i++) await p.locator('button[aria-label$="to the show"]:not([disabled])').first().click()
  if (tabbed) await p.getByTestId('nav-show').click()
  for (let i = 0; i < 3; i++) await p.getByTestId('add-mic').click()
}
await run('full-list', { width: 1440, height: 900 }, async (p) => { await fill(p); await p.getByRole('button', { name: 'Spread mic breaks' }).click() })
await run('full-timeline', { width: 1440, height: 900 }, async (p) => { await fill(p); await p.getByRole('button', { name: 'Timeline', exact: true }).click() })
await run('phone-show', { width: 390, height: 844 }, async (p) => { await fill(p); await p.getByTestId('nav-show').click() })
await run('phone-check', { width: 390, height: 844 }, async (p) => { await fill(p); await p.getByTestId('nav-check').click() })
await run('import-dialog', { width: 1440, height: 900 }, async (p) => { await p.getByRole('button', { name: /Import songs/ }).click() })
console.log('errors', errors); await browser.close()
