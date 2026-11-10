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
  await page.getByRole('button', { name: 'Write back' }).first().click()
  const notebook = page.locator('.notebook-panel')
  await expect(notebook).toHaveCSS('transform', 'none')
  const bounds = await notebook.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await page.getByRole('textbox', { name: 'YOUR REPLY' }).fill('I kept your words close all day.')
  await page.getByRole('button', { name: 'Save this page' }).click()
  await expect(page.getByText('I kept your words close all day.').first()).toBeVisible()
  await expect(page.locator('.reply-byline').first()).toContainText('A NOTE BACK')
  await expect(page.locator('.reply-byline').first()).not.toContainText('Invalid Date')
})

test('owner can edit a saved letter in the notebook', async ({ page }) => {
  await page.goto('/')
  await page.locator('.letter-card > .saved-page-actions .page-action').filter({ hasText: 'Edit page' }).click()
  await expect(page.getByRole('heading', { name: 'A page, revisited' })).toBeVisible()
  await page.locator('.notebook-panel input[name="title"]').fill('A letter we keep')
  await page.getByRole('textbox', { name: 'THE WORDS I WANT TO KEEP' }).fill('These words still feel true.')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.locator('#letters').getByRole('heading', { name: 'A letter we keep' })).toBeVisible()
  await expect(page.locator('#letters').getByText('These words still feel true.')).toBeVisible()
})

test('memory cards have matching photo sizes and offer replies', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.locator('.gallery-window').hover()
  const imageSizes = await page.locator('.gallery-card:not([aria-hidden="true"]) .gallery-image').evaluateAll((images) => images.map((image) => ({ width: image.clientWidth, height: image.clientHeight })))
  expect(imageSizes.length).toBeGreaterThan(1)
  expect(new Set(imageSizes.map((size) => `${size.width}x${size.height}`)).size).toBe(1)
  await page.locator('.gallery-card:not([aria-hidden="true"]) .page-action').filter({ hasText: 'Write back' }).first().click()
  await expect(page.locator('.notebook-panel').getByRole('heading', { name: 'Write back' })).toBeVisible()
  await expect(page.locator('.notebook-context')).toContainText('The long way home')
  await page.getByRole('textbox', { name: 'YOUR REPLY' }).fill('That day is one of my favorites too.')
  await page.getByRole('button', { name: 'Save this page' }).click()
  await expect(page.locator('.gallery-run:not([aria-hidden="true"]) .gallery-card').filter({ hasText: 'The long way home' }).getByText('That day is one of my favorites too.')).toBeVisible()
})

test('Add Note has a stable, usable button size on mobile and desktop', async ({ page }) => {
  await page.goto('/')
  const addButton = page.getByRole('button', { name: 'Add a note' })
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    const bounds = await addButton.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.width).toBeGreaterThanOrEqual(38)
    expect(bounds!.height).toBeGreaterThanOrEqual(38)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
  }
})