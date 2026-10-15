import { expect, test, type Page, type Route } from '@playwright/test'

const services = [{ code: 'water_tanker', name: 'Water tanker', description: 'Reliable supply', base_price_paise: 250000, is_active: true }]
const offers = [{ id: 'offer-1', code: 'WELCOME10', title: 'Welcome discount', discount_type: 'percentage', discount_value: 10, is_active: true }]

async function mockBookingApi(page: Page) {
  const fulfill = (body: unknown, status = 200) => (route: Route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/customer/services', fulfill(services))
  await page.route('**/api/customer/offers', fulfill(offers))
  await page.route('**/api/customer/coupons/validate', fulfill({ valid: true, coupon: { discount_type: 'percentage', discount_value: 10 } }))
  await page.route('**/api/customer/orders/quote', fulfill({ id: 'booking-1', quotedAmountPaise: 250000 }))
}

async function completeBookingDetails(page: Page) {
  await page.getByRole('button', { name: /Book now|New booking/ }).first().click()
  await page.getByRole('checkbox', { name: /Water tanker/ }).check()
  await page.getByRole('textbox', { name: /Delivery location/ }).fill('MG Road, Bengaluru')
  await page.getByRole('textbox', { name: 'Preferred date' }).fill('2026-10-20')
  await page.getByRole('textbox', { name: /Mobile number/ }).fill('9876543210')
  await page.getByRole('button', { name: 'Review request' }).click()
  await page.getByRole('button', { name: /Continue to payment/ }).click()
}

test('guest can verify mocked OTP and complete COD booking without leaving payment', async ({ page }) => {
  await mockBookingApi(page)
  await page.route('**/api/auth/guest/request-otp', route => route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ challengeId: '00000000-0000-0000-0000-000000000001', expiresInSeconds: 600 }) }))
  await page.route('**/api/auth/guest/verify-otp', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'mock-access-token', user: { username: 'guest_9876543210', name: 'Test Guest', role: 'customer' } }) }))

  await page.goto('/')
  await completeBookingDetails(page)
  await page.getByRole('button', { name: /WELCOME10/ }).click()
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByRole('textbox', { name: 'Mobile verification code' }).fill('123456')
  await page.getByRole('button', { name: 'Verify' }).click()

  await expect(page.getByText('Your mobile number will receive booking updates and delivery OTP.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Choose how to pay.' })).toBeVisible()
  await page.getByRole('radio', { name: /Cash on delivery/ }).check()
  await page.getByRole('button', { name: /Confirm booking/ }).click()
  await expect(page.getByRole('heading', { name: 'Request received.' })).toBeVisible()
})

test('authenticated customer can complete COD booking', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('urban-tanker-auth', JSON.stringify({
      state: { user: { username: 'customer@example.com', name: 'Test Customer', role: 'customer' } },
      version: 0,
    }))
  })
  await mockBookingApi(page)

  await page.goto('/')
  await completeBookingDetails(page)
  await page.getByRole('radio', { name: /Cash on delivery/ }).check()
  await page.getByRole('button', { name: /Confirm booking/ }).click()
  await expect(page.getByRole('heading', { name: 'Request received.' })).toBeVisible()
})

test('booking blocks invalid mobile numbers before review', async ({ page }) => {
  await mockBookingApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Book now' }).first().click()
  await page.getByRole('checkbox', { name: /Water tanker/ }).check()
  await page.getByRole('textbox', { name: /Delivery location/ }).fill('MG Road, Bengaluru')
  await page.getByRole('textbox', { name: 'Preferred date' }).fill('2026-10-20')
  await page.getByRole('textbox', { name: /Mobile number/ }).fill('123')
  await page.getByRole('button', { name: 'Review request' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Enter a valid 10-digit mobile number.' }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tell us what you need.' })).toBeVisible()
})
