import { expect, test } from '@playwright/test'

const orders = [
  { id: 'booking-1', reference: 'UT-TEST-1', service: 'Water tanker · 12 KL', location: 'OMR, Chennai', distance: 5.2, amount: '₹2,250', status: 'Available' },
  { id: 'booking-2', reference: 'UT-TEST-2', service: 'Sewage tanker · 9 KL', location: 'Guindy, Chennai', distance: 11.4, amount: '₹2,900', status: 'Accepted', vehicle: 'TN 38 AB 4120', driver: 'Arun Kumar' },
]

test('vendor can log in, open order inbox, assign fleet, and start delivery', async ({ page }) => {
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      accessToken: 'vendor-test-token',
      user: { username: 'vendor@test.example', name: 'Test Vendor', role: 'vendor' },
    }),
  }))
  await page.route('**/api/vendor/orders', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(orders) }))
  await page.route('**/api/vendor/vehicles', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'vehicle-1', registration_number: 'TN 38 AB 4120', capacity_litres: 12000, is_active: true, verification: 'approved' }]) }))
  await page.route('**/api/vendor/drivers', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'driver-1', name: 'Arun Kumar', mobile_e164: '+919876543210', is_active: true, verification: 'approved' }]) }))
  await page.route('**/api/vendor/offline-mutations', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/vendor/dashboard', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders, vehicles: [], drivers: [] }) }))
  await page.route('**/api/vendor/orders/booking-1/transition', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...orders[0], status: 'Assigned', vehicle: 'TN 38 AB 4120', driver: 'Arun Kumar' }) }))
  await page.route('**/api/vendor/orders/booking-2/transition', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...orders[1], status: 'En route' }) }))

  await page.goto('/')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByLabel('Username or email').fill('vendor@test.example')
  await page.locator('#login-password').fill('vendor-password')
  await page.getByRole('button', { name: /^Log in$/ }).last().click()

  await expect(page.getByText('Test Vendor')).toBeVisible()
  await page.getByRole('button', { name: 'Orders' }).click()
  await expect(page.getByRole('heading', { name: 'Nearby delivery requests.' })).toBeVisible()
  await expect(page.getByText('UT-TEST-1 · Water tanker · 12 KL')).toBeVisible()

  await page.getByRole('button', { name: 'Assign fleet' }).click()
  await page.getByLabel('Vehicle').selectOption({ label: 'TN 38 AB 4120 · 12 KL' })
  await page.getByLabel('Driver').selectOption({ label: 'Arun Kumar' })
  await page.getByRole('button', { name: 'Save assignment' }).click()
  await expect(page.getByText('booking-1 assigned to vehicle and driver.')).toBeVisible()

  await page.getByRole('button', { name: 'Start delivery' }).click()
  await expect(page.getByText('booking-2 marked En route.')).toBeVisible()
})
