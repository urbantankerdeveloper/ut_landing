import { expect, test } from '@playwright/test'

const apiBaseUrl = process.env.SMOKE_API_URL ?? 'http://localhost:8080'

test('public landing page exposes the booking entry point', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Book now' }).first()).toBeVisible()
  await expect(page.getByText('Urban Tanker.')).toBeVisible()
})

test('protected admin API rejects unauthenticated access', async ({ request }) => {
  const response = await request.get(`${apiBaseUrl}/api/admin/orders`)
  expect(response.status()).toBe(401)
})
