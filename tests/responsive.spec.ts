import { expect, test } from '@playwright/test'

test('homepage fits mobile, tablet, and desktop viewports', async ({ page }) => {
  for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /all my days/i })).toBeVisible()
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      content: document.documentElement.scrollWidth,
    }))
    expect(dimensions.content, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport)
  }
})

test('reply notebook saves and renders a dated reply in its letter thread', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Write a little reply' }).click()
  const notebook = page.locator('.notebook-panel')
  await expect(notebook).toHaveCSS('transform', 'none')
  const bounds = await notebook.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await page.getByRole('textbox', { name: 'YOUR REPLY' }).fill('I kept your words close all day.')
  await page.getByRole('button', { name: 'Save this page' }).click()
  await expect(page.getByText('I kept your words close all day.')).toBeVisible()
  await expect(page.locator('.reply-byline').first()).toContainText('A NOTE BACK')
  await expect(page.locator('.reply-byline').first()).not.toContainText('Invalid Date')
})