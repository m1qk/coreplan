import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto('http://localhost:4174/')
await page.getByTestId('load-demo').click()
await page.waitForTimeout(300)
const btn = page.getByRole('button', { name: /^Add Neon Parking Lot to the show$/ })
for (let i = 0; i < 6; i++) { console.log(JSON.stringify(await btn.boundingBox())); await page.waitForTimeout(200) }
const info = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="track-card"]')
  const anims = document.getAnimations().map(a => ({ target: a.effect?.target?.className?.toString().slice(0,60) ?? a.effect?.target?.tagName, name: a.animationName ?? a.transitionProperty, state: a.playState }))
  return { anims }
})
console.log(JSON.stringify(info, null, 1))
await page.screenshot({ path: '/tmp/claude-0/-home-claude/f98ac2b7-c3c4-5e91-9992-4e460ece75c1/scratchpad/shots/debug.png' })
await browser.close()
