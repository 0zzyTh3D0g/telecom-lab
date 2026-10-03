import { expect, test } from '@playwright/test'

test('shell, privacy and responsive layout stay usable without configured backend', async ({ page }) => {
  for (const width of [320,375,768,1024,1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/#/privacy')
    await expect(page.getByRole('heading',{name:'Privacy e attività'})).toBeVisible()
    await expect(page.getByText('Progettata da Francesco Di Martino · 4ITC1 · A.S. 2026/2027')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
    expect(overflow,`Horizontal page overflow at ${width}px`).toBe(false)
  }
})
