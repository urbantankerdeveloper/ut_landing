import { expect, test } from '@playwright/test'

test('public landing page exposes the booking entry point', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Book now' }).first()).toBeVisible()
  await expect(page.getByText('Urban Tanker.')).toBeVisible()
})

test('protected admin API rejects unauthenticated access', async ({ request }) => {
  const response = await request.get('http://localhost:8080/api/admin/orders')
  expect(response.status()).toBe(401)
})
