import { expect, test, type Page, type Route } from '@playwright/test'

const services = [
  { code: 'water_tanker', name: 'Water tanker', description: 'Reliable supply', base_price_paise: 250000, is_active: true },
  { code: 'tank_cleaning', name: 'Tank cleaning', description: 'Tank cleaning', base_price_paise: 180000, is_active: true },
]
const offers = [{ id: 'offer-1', code: 'WELCOME10', title: 'Welcome discount', discount_type: 'percentage', discount_value: 10, is_active: true }]

async function mockBookingApi(page: Page) {
  const fulfill = (body: unknown, status = 200) => (route: Route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const bookingPayloads: Record<string, unknown>[] = []
  await page.route('**/api/customer/services', fulfill(services))
  await page.route('**/api/customer/offers', fulfill(offers))
  await page.route('**/api/customer/coupons/validate', fulfill({ valid: true, coupon: { discount_type: 'percentage', discount_value: 10 } }))
  await page.route('**/api/customer/orders/quote', route => {
    bookingPayloads.push(route.request().postDataJSON() as Record<string, unknown>)
    return fulfill({ id: 'booking-1', quotedAmountPaise: 250000 })(route)
  })
  return bookingPayloads
}

async function completeBookingDetails(page: Page) {
  await page.getByRole('button', { name: /Book now|New booking/ }).first().click()
  await page.getByRole('checkbox', { name: /Water tanker/ }).check()
  await page.getByLabel('Water type and delivery requirements for Water tanker').fill('Potable water for the building')
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

test('multiple services retain separate details in one booking request', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('urban-tanker-auth', JSON.stringify({
      state: { user: { username: 'customer@example.com', name: 'Test Customer', role: 'customer' } },
      version: 0,
    }))
  })
  const bookingPayloads = await mockBookingApi(page)

  await page.goto('/')
  await page.getByRole('button', { name: /Book now|New booking/ }).first().click()
  await page.getByRole('checkbox', { name: /Water tanker/ }).check()
  await page.getByRole('checkbox', { name: /Tank cleaning/ }).check()
  await page.getByLabel('Delivery capacity (litres)').fill('5,000 litres')
  await page.getByLabel('Water type and delivery requirements for Water tanker').fill('Potable water for the building')
  await page.getByLabel('Tank size or number of tanks').fill('2 tanks')
  await page.getByLabel('Tank type and cleaning requirements for Tank cleaning').fill('Clean the rooftop tanks')
  await page.getByRole('textbox', { name: /Delivery location/ }).fill('MG Road, Bengaluru')
  await page.getByRole('textbox', { name: 'Preferred date' }).fill('2026-10-20')
  await page.getByRole('textbox', { name: /Mobile number/ }).fill('9876543210')
  await page.getByRole('button', { name: 'Review request' }).click()
  await page.getByRole('button', { name: /Continue to payment/ }).click()
  await page.getByRole('radio', { name: /Cash on delivery/ }).check()
  await page.getByRole('button', { name: /Confirm booking/ }).click()

  await expect(page.getByRole('heading', { name: 'Request received.' })).toBeVisible()
  expect(bookingPayloads).toHaveLength(1)
  expect(bookingPayloads[0].serviceId).toBe('water_tanker')
  expect(bookingPayloads[0].services).toEqual([
    { serviceId: 'water_tanker', capacity: '5,000 litres', details: 'Potable water for the building' },
    { serviceId: 'tank_cleaning', capacity: '2 tanks', details: 'Clean the rooftop tanks' },
  ])
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

test('customer signup confirms that an email was sent', async ({ page }) => {
  await page.route('**/api/auth/signup', route => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({ requiresEmailVerification: true, emailSent: true, userId: 'customer-1' }),
  }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByRole('button', { name: 'Create an account' }).click()
  await page.getByLabel('Full name').fill('Test Customer')
  await page.getByLabel('Phone number').fill('9876543210')
  await page.getByLabel('Email').fill('customer@example.com')
  await page.locator('#login-password').fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('status')).toHaveText('Account created. Check your email and confirm your address before signing in.')
})

test('customer signup displays SMTP configuration errors', async ({ page }) => {
  await page.route('**/api/auth/signup', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Email confirmation is unavailable. Configure SMTP_USER, SMTP_PASSWORD, and MAIL_FROM on the backend, then try again.' }),
  }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByRole('button', { name: 'Create an account' }).click()
  await page.getByLabel('Full name').fill('Test Customer')
  await page.getByLabel('Phone number').fill('9876543210')
  await page.getByLabel('Email').fill('customer@example.com')
  await page.locator('#login-password').fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('alert')).toContainText('Email confirmation is unavailable')
})

test('password reset request is sent through the backend email flow', async ({ page }) => {
  let resetPayload: Record<string, unknown> | undefined
  await page.route('**/api/auth/password-reset', route => {
    resetPayload = route.request().postDataJSON() as Record<string, unknown>
    return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ accepted: true }) })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.getByLabel('Email').fill('customer@example.com')
  await page.getByRole('button', { name: 'Send reset instructions' }).click()
  await expect(page.getByRole('status')).toHaveText('If that account exists, reset instructions will be sent shortly.')
  expect(resetPayload).toEqual({ email: 'customer@example.com' })
})

test('password recovery link can update the password', async ({ page }) => {
  let updatePayload: Record<string, unknown> | undefined
  await page.route('**/api/auth/password-update', route => {
    updatePayload = route.request().postDataJSON() as Record<string, unknown>
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updated: true }) })
  })
  await page.goto('/#access_token=mock-recovery-access-token&type=recovery')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByLabel('New password', { exact: true }).fill('new-password-123')
  await page.getByLabel('Confirm new password').fill('new-password-123')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page.getByRole('status')).toHaveText('Your password has been updated. You can now sign in.')
  expect(updatePayload).toEqual({ accessToken: 'mock-recovery-access-token', password: 'new-password-123' })
})
