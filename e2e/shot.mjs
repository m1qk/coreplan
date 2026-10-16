import { chromium } from 'playwright-core'
const out = process.argv[2]
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
const errors = []
async function run(name, viewport, steps) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 800 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`))
  await page.goto('http://localhost:4174/')
  await page.waitForSelector('h1')
  await steps(page)
  await page.screenshot({ path: `${out}/${name}.png` })
  await ctx.close()
}
await run('desktop-empty', { width: 1440, height: 900 }, async () => {})
await run('desktop-demo', { width: 1440, height: 900 }, async (p) => {
  await p.getByTestId('load-demo').click()
  for (let i = 0; i < 6; i++) await p.locator('button[aria-label$="to the show"]:not([disabled])').first().click()
  await p.getByTestId('add-mic').click()
  await p.waitForTimeout(500)
})
await run('mobile-empty', { width: 390, height: 844 }, async () => {})
console.log('errors:', errors)
await browser.close()
