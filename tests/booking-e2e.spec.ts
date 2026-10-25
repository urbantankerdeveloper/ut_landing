import { expect, test, type Page, type Route } from '@playwright/test'

const services = [
  { code: 'water_tanker', name: 'Water tanker', description: 'Reliable supply', base_price_paise: 250000, is_active: true },
  { code: 'tank_cleaning', name: 'Tank cleaning', description: 'Tank cleaning', base_price_paise: 180000, is_active: true },
]
const offers = [{ id: 'offer-1', code: 'WELCOME10', title: 'Welcome discount', discount_type: 'percentage', discount_value: 10, is_active: true }]

function futureDateInputValue(days = 1) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

async function mockBookingApi(page: Page, verifiedPhone = false) {
  const fulfill = (body: unknown, status = 200) => (route: Route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const bookingPayloads: Record<string, unknown>[] = []
  await page.route('https://nominatim.openstreetmap.org/reverse*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ display_name: 'T Nagar, Chennai, India', address: { suburb: 'T Nagar', city: 'Chennai', state: 'Tamil Nadu' } }),
  }))
  await page.route('**/api/auth/guest/request-otp', fulfill({ challengeId: '00000000-0000-4000-8000-000000000001', expiresInSeconds: 600 }, 202))
  await page.route('**/api/auth/guest/verify-otp', fulfill({ accessToken: 'mock-access-token', user: { username: 'guest_9876543210', name: 'Test Guest', role: 'customer' } }))
  await page.route('**/api/auth/guest/verify-phone', fulfill({ verified: true }))
  await page.route('**/api/customer/orders', fulfill([]))
  await page.route('**/api/customer/phone-verification', fulfill({ phone: '9876543210', verified: verifiedPhone }))
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
  await page.getByRole('button', { name: /Book now|Start a new booking/ }).first().click()
  await page.getByRole('checkbox', { name: /Water tanker/ }).check()
  await page.getByRole('button', { name: 'Water tanker details' }).click()
  await page.getByLabel('Water type and delivery requirements for Water tanker').fill('Potable water for the building')
  await page.getByLabel('Preferred delivery date for Water tanker').fill('2026-11-20')
  await page.getByRole('textbox', { name: 'Delivery location for Water tanker' }).fill('MG Road, Chennai')
  await page.getByRole('textbox', { name: /Mobile number/ }).fill('9876543210')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByRole('textbox', { name: 'Mobile verification code' }).fill('123456')
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByText('Mobile number verified. It can be used for all selected services.')).toBeVisible()
  await page.getByRole('button', { name: 'Review request' }).click()
  await page.getByRole('button', { name: /Continue to payment/ }).click()
}

test('guest can verify mocked OTP and complete COD booking without leaving payment', async ({ page }) => {
  await mockBookingApi(page)

  await page.goto('/')
  await completeBookingDetails(page)
  await page.getByRole('button', { name: /WELCOME10/ }).click()

  await expect(page.getByText('This shared number is verified and will receive booking updates and delivery OTPs.')).toBeVisible()
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

test('verified saved phone skips OTP until the customer changes the number', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('urban-tanker-auth', JSON.stringify({
      state: { user: { username: 'customer@example.com', name: 'Test Customer', role: 'customer' } },
      version: 0,
    }))
  })
  await mockBookingApi(page, true)
  await page.goto('/')
  await page.getByRole('button', { name: /Book now|Start a new booking/ }).first().click()
  await page.getByRole('checkbox', { name: /Water tanker/ }).check()

  const mobileInput = page.getByRole('textbox', { name: 'Mobile number' })
  await expect(mobileInput).toHaveValue('9876543210')
  await expect(page.getByText('Mobile number verified. It can be used for all selected services.')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Mobile verification code' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Send code' })).toHaveCount(0)

  await mobileInput.fill('9123456789')
  await expect(page.getByRole('textbox', { name: 'Mobile verification code' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send code' })).toBeVisible()
  await expect(page.getByText('Mobile number verified. It can be used for all selected services.')).toHaveCount(0)
})

test('selected service details collapse and can be removed from selection', async ({ page }) => {
  await mockBookingApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Book now|Start a new booking/ }).first().click()
  const waterService = page.getByRole('checkbox', { name: /Water tanker/ })
  await waterService.check()

  const accordionToggle = page.getByRole('button', { name: 'Water tanker details' })
  await expect(accordionToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByLabel('Preferred delivery date for Water tanker')).toHaveCount(0)
  await accordionToggle.click()
  await expect(accordionToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByLabel('Preferred delivery date for Water tanker')).toBeVisible()
  const locationRow = page.locator('.delivery-location-row').first()
  await expect(locationRow).toHaveCSS('display', 'grid')
  await expect(page.getByRole('button', { name: 'Choose Water tanker delivery location on map' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use current location for Water tanker' })).toBeVisible()
  await accordionToggle.click()
  await expect(accordionToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByLabel('Preferred delivery date for Water tanker')).toHaveCount(0)
  await accordionToggle.click()

  await page.getByRole('button', { name: 'Remove Water tanker' }).click()
  await expect(waterService).not.toBeChecked()
  await expect(accordionToggle).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '0 services' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /Delivery location/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /delivery location on map/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Use current location for/ })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: /Mobile number/ })).toHaveCount(0)
  await expect(page.getByLabel('Delivery access notes')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Review request' })).toHaveCount(0)
})

test('out-of-service locations show a toast and require a Chennai location', async ({ page }) => {
  await mockBookingApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Book now' }).first().click()
  await page.getByRole('checkbox', { name: /Water tanker/ }).check()
  await page.getByRole('button', { name: 'Water tanker details' }).click()

  const locationInput = page.getByRole('textbox', { name: 'Delivery location for Water tanker' })
  await locationInput.fill('Erode, Tamil Nadu')
  await locationInput.press('Tab')
  await expect(page.getByRole('alert').filter({ hasText: 'We currently deliver only within Chennai.' })).toBeVisible()
  await expect(locationInput).toHaveAttribute('aria-invalid', 'true')

  await locationInput.fill('T Nagar, Chennai')
  await locationInput.press('Tab')
  await expect(page.getByRole('alert').filter({ hasText: 'We currently deliver only within Chennai.' })).toHaveCount(0)
  await expect(locationInput).not.toHaveAttribute('aria-invalid', 'true')
})

test('booking validates each service date and requirement before review', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('urban-tanker-auth', JSON.stringify({
      state: { user: { username: 'customer@example.com', name: 'Test Customer', role: 'customer' } },
      version: 0,
    }))
  })
  await mockBookingApi(page, true)
  await page.goto('/')
  await page.getByRole('button', { name: /Book now|Start a new booking/ }).first().click()
  await page.getByRole('checkbox', { name: /Water tanker/ }).check()
  await page.getByRole('button', { name: 'Water tanker details' }).click()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const pastDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
  await page.getByLabel('Preferred delivery date for Water tanker').fill(pastDate)
  await page.getByLabel('Water type and delivery requirements for Water tanker').fill('ok')
  await page.getByRole('textbox', { name: 'Delivery location for Water tanker' }).fill('MG Road, Chennai')
  const reviewButton = page.getByRole('button', { name: 'Review request' })
  await expect(reviewButton).toBeDisabled()
  await page.getByLabel('Preferred delivery date for Water tanker').fill(futureDateInputValue())
  await page.getByLabel('Water type and delivery requirements for Water tanker').fill('Potable water for the building')
  await expect(reviewButton).toBeEnabled()
})

test('review request stays disabled until every selected service is complete', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('urban-tanker-auth', JSON.stringify({
      state: { user: { username: 'customer@example.com', name: 'Test Customer', role: 'customer' } },
      version: 0,
    }))
  })
  await mockBookingApi(page, true)
  await page.goto('/')
  await page.getByRole('button', { name: /Book now|Start a new booking/ }).first().click()
  await page.getByRole('checkbox', { name: /Water tanker/ }).check()
  await page.getByRole('checkbox', { name: /Tank cleaning/ }).check()
  const reviewButton = page.getByRole('button', { name: 'Review request' })
  await expect(reviewButton).toBeDisabled()

  await page.getByRole('button', { name: 'Water tanker details' }).click()
  await page.getByRole('button', { name: 'Tank cleaning details' }).click()
  await page.getByLabel('Preferred delivery date for Water tanker').fill(futureDateInputValue())
  await page.getByLabel('Water type and delivery requirements for Water tanker').fill('Potable water for the building')
  await page.getByRole('textbox', { name: 'Delivery location for Water tanker' }).fill('MG Road, Chennai')
  await expect(reviewButton).toBeDisabled()

  await page.getByLabel('Preferred delivery date for Tank cleaning').fill(futureDateInputValue(2))
  await page.getByLabel('Tank type and cleaning requirements for Tank cleaning').fill('Clean the rooftop tanks')
  await page.getByRole('textbox', { name: 'Delivery location for Tank cleaning' }).fill('OMR, Chennai')
  await expect(page.getByRole('textbox', { name: 'Mobile number' })).toHaveValue('9876543210')
  await expect(page.getByText('Mobile number verified. It can be used for all selected services.')).toBeVisible()
  await expect(reviewButton).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'Tell us what you need.' })).toBeVisible()
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
  await page.getByRole('button', { name: /Book now|Start a new booking/ }).first().click()
  await page.getByRole('checkbox', { name: /Water tanker/ }).check()
  await page.getByRole('checkbox', { name: /Tank cleaning/ }).check()
  await page.getByRole('button', { name: 'Water tanker details' }).click()
  await page.getByRole('button', { name: 'Tank cleaning details' }).click()
  await page.getByLabel('Delivery capacity (litres)').fill('5,000 litres')
  await page.getByLabel('Water type and delivery requirements for Water tanker').fill('Potable water for the building')
  await page.getByLabel('Preferred delivery date for Water tanker').fill('2026-11-20')
  await page.getByLabel('Tank size or number of tanks').fill('2 tanks')
  await page.getByLabel('Tank type and cleaning requirements for Tank cleaning').fill('Clean the rooftop tanks')
  await page.getByLabel('Preferred delivery date for Tank cleaning').fill('2026-11-22')
  await page.getByRole('textbox', { name: 'Delivery location for Water tanker' }).fill('MG Road, Chennai')
  await page.getByRole('textbox', { name: 'Delivery location for Tank cleaning' }).fill('OMR, Chennai')
  await page.getByRole('textbox', { name: /Mobile number/ }).fill('9876543210')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByRole('textbox', { name: 'Mobile verification code' }).fill('123456')
  await page.getByRole('button', { name: 'Verify' }).click()
  await page.getByRole('button', { name: 'Review request' }).click()
  await page.getByRole('button', { name: /Continue to payment/ }).click()
  await page.getByRole('radio', { name: /Cash on delivery/ }).check()
  await page.getByRole('button', { name: /Confirm booking/ }).click()

  await expect(page.getByRole('heading', { name: 'Request received.' })).toBeVisible()
  await expect(page.getByRole('banner').getByRole('button', { name: 'My account', exact: true })).toBeVisible()
  await page.getByRole('banner').getByRole('button', { name: 'My account', exact: true }).click()
  await page.getByRole('dialog', { name: 'Leave booking?' }).getByRole('button', { name: 'Leave booking' }).click()
  await expect(page.getByRole('button', { name: 'My Bookings' })).toBeVisible()
  expect(bookingPayloads).toHaveLength(1)
  expect(bookingPayloads[0].serviceId).toBe('water_tanker')
  expect(bookingPayloads[0].phone).toBe('9876543210')
  expect(bookingPayloads[0].phoneVerificationChallengeId).toBe('00000000-0000-4000-8000-000000000001')
  expect(bookingPayloads[0].services).toEqual([
    { serviceId: 'water_tanker', capacity: '5,000 litres', details: 'Potable water for the building', deliveryDate: '2026-11-20', location: 'MG Road, Chennai' },
    { serviceId: 'tank_cleaning', capacity: '2 tanks', details: 'Clean the rooftop tanks', deliveryDate: '2026-11-22', location: 'OMR, Chennai' },
  ])
})

test('booking blocks invalid mobile numbers before review', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('urban-tanker-auth', JSON.stringify({
      state: { user: { username: 'customer@example.com', name: 'Test Customer', role: 'customer' } },
      version: 0,
    }))
  })
  await mockBookingApi(page, true)
  await page.goto('/')
  await page.getByRole('button', { name: /Book now|Start a new booking/ }).first().click()
  await page.getByRole('checkbox', { name: /Water tanker/ }).check()
  await page.getByRole('button', { name: 'Water tanker details' }).click()
  await page.getByLabel('Preferred delivery date for Water tanker').fill(futureDateInputValue())
  await page.getByLabel('Water type and delivery requirements for Water tanker').fill('Potable water for the building')
  await page.getByRole('textbox', { name: 'Delivery location for Water tanker' }).fill('MG Road, Chennai')
  const mobileInput = page.getByRole('textbox', { name: 'Mobile number' })
  await expect(mobileInput).toHaveValue('9876543210')
  await mobileInput.fill('123')
  await expect(page.getByRole('button', { name: 'Review request' })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Mobile verification code' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tell us what you need.' })).toBeVisible()
})

test('customer profile loads saved name, email, and phone values', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('urban-tanker-auth', JSON.stringify({
      state: { user: { username: 'customer@example.com', name: 'Test Customer', role: 'customer' } },
      version: 0,
    }))
  })
  await page.route('**/api/customer/profile', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ name: 'Test Customer', email: 'customer@example.com', phone: '9876543210' }),
  }))

  await page.goto('/')
  await page.getByRole('button', { name: 'My profile' }).click()
  await expect(page.getByRole('textbox', { name: 'Full name' })).toHaveValue('Test Customer')
  await expect(page.getByRole('textbox', { name: 'Email address' })).toHaveValue('customer@example.com')
  await expect(page.getByRole('textbox', { name: 'Phone number' })).toHaveValue('9876543210')
  const saveProfileButton = page.getByRole('button', { name: 'Save profile' })
  await expect(saveProfileButton).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
  await expect(saveProfileButton).toBeDisabled()
  const nameInput = page.getByRole('textbox', { name: 'Full name' })
  await nameInput.fill('Updated Customer')
  await expect(saveProfileButton).toBeEnabled()
  await nameInput.fill('Test Customer')
  await expect(saveProfileButton).toBeDisabled()
})

test('customer profile submits changed values to the profile update API', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('urban-tanker-auth', JSON.stringify({
      state: { user: { username: 'customer@example.com', name: 'Test Customer', role: 'customer' } },
      version: 0,
    }))
  })
  let submittedProfile: Record<string, string> | undefined
  await page.route('**/api/customer/profile', async route => {
    if (route.request().method() === 'PATCH') {
      submittedProfile = route.request().postDataJSON() as Record<string, string>
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...submittedProfile, phone: '' }) })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ name: 'Test Customer', email: 'customer@example.com', phone: '' }),
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'My profile' }).click()
  await page.getByRole('textbox', { name: 'Full name' }).fill('Jane Doe')
  await page.getByRole('button', { name: 'Save profile' }).click()

  await expect.poll(() => submittedProfile).toEqual({
    name: 'Jane Doe',
    email: 'customer@example.com',
  })
  await expect(page.getByRole('status').filter({ hasText: 'Profile changes saved.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeDisabled()
})

test('customer can view booking details and repeat a multi-service booking', async ({ page }) => {
  const booking = {
    id: 'booking-42',
    service_code: 'water_tanker',
    service_details: [
      { serviceId: 'water_tanker', capacity: '5,000 litres', details: 'Potable water for the building', deliveryDate: '2026-11-20', location: 'MG Road, Chennai' },
      { serviceId: 'tank_cleaning', capacity: '2 tanks', details: 'Clean the rooftop tanks', deliveryDate: '2026-11-22', location: 'OMR, Chennai' },
    ],
    address_text: 'MG Road, Chennai',
    customer_phone_e164: '9876543210',
    access_notes: 'Use the north entrance',
    payment_method: 'cod',
    status: 'pending_vendor',
    quoted_amount_paise: 430000,
    scheduled_for: '2026-11-20',
  }
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ accessToken: 'mock-access-token', user: { id: 'customer-1', username: 'customer@example.com', name: 'Test Customer', role: 'customer' } }),
  }))
  await page.route('**/api/customer/orders', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([booking]) }))
  await page.route('**/api/customer/services', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(services) }))
  await page.route('**/api/customer/offers', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(offers) }))

  await page.goto('/')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByLabel('Username or email').fill('customer@example.com')
  await page.locator('#login-password').fill('password123')
  await page.getByRole('button', { name: 'Log in' }).last().click()
  await expect(page.getByRole('banner').getByRole('button', { name: 'Book now', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'My Bookings' }).click()
  await expect(page.getByRole('button', { name: 'New booking', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Tell us what you need.' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Book now', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tell us what you need.' })).toBeVisible()
  await page.getByRole('banner').getByRole('button', { name: 'My account', exact: true }).click()
  await page.getByRole('dialog', { name: 'Leave booking?' }).getByRole('button', { name: 'Leave booking' }).click()
  await page.getByRole('button', { name: 'My Bookings' }).click()

  await page.getByRole('button', { name: 'Actions for booking booking-42' }).click()
  const bookingActions = page.getByRole('menu')
  await expect(bookingActions).toHaveCSS('position', 'fixed')
  expect(await bookingActions.evaluate((menu) => menu.parentElement === document.body)).toBe(true)
  await expect(bookingActions.getByRole('menuitem', { name: 'Book again' })).toBeVisible()
  await expect(bookingActions.getByRole('menuitem', { name: 'View' })).toBeVisible()
  await bookingActions.getByRole('menuitem', { name: 'View' }).click()
  const detailsDialog = page.getByRole('dialog', { name: 'Booking booking-42' })
  await expect(detailsDialog).toContainText('Potable water for the building')
  await expect(detailsDialog).toContainText('Clean the rooftop tanks')
  await expect(detailsDialog).toContainText('Preferred date:')
  await expect(detailsDialog).toContainText('Use the north entrance')
  await expect(detailsDialog).toContainText('9876543210')
  await page.getByRole('button', { name: 'Close dialog' }).click()

  await page.getByRole('button', { name: 'Actions for booking booking-42' }).click()
  await page.getByRole('menuitem', { name: 'Book again' }).click()
  await expect(page.getByRole('heading', { name: 'Tell us what you need.' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Water tanker/ })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /Tank cleaning/ })).toBeChecked()
  await page.getByRole('button', { name: 'Water tanker details' }).click()
  await page.getByRole('button', { name: 'Tank cleaning details' }).click()
  await expect(page.getByLabel('Delivery capacity (litres)')).toHaveValue('5,000 litres')
  await expect(page.getByLabel('Preferred delivery date for Water tanker')).toHaveValue('2026-11-20')
  await expect(page.getByLabel('Preferred delivery date for Tank cleaning')).toHaveValue('2026-11-22')
  await expect(page.getByLabel('Tank type and cleaning requirements for Tank cleaning')).toHaveValue('Clean the rooftop tanks')
  await expect(page.getByRole('textbox', { name: 'Delivery location for Water tanker' })).toHaveValue('MG Road, Chennai')
  await expect(page.getByRole('textbox', { name: 'Delivery location for Tank cleaning' })).toHaveValue('OMR, Chennai')
  await expect(page.getByRole('textbox', { name: /Mobile number/ })).toHaveValue('9876543210')
  await expect(page.getByLabel('Delivery access notes')).toHaveValue('Use the north entrance')
})

test('signed-in customer stays on booking and confirms before leaving selected services', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('urban-tanker-auth', JSON.stringify({
      state: { user: { username: 'customer@example.com', name: 'Test Customer', role: 'customer' } },
      version: 0,
    }))
  })
  await mockBookingApi(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'My Bookings' }).click()
  await page.getByRole('button', { name: 'Book now', exact: true }).click()

  const waterService = page.getByRole('checkbox', { name: /Water tanker/ })
  await waterService.check()
  await expect(page.getByRole('heading', { name: 'Tell us what you need.' })).toBeVisible()
  await expect(waterService).toBeChecked()

  await page.getByRole('button', { name: 'Urban Tanker home' }).click()
  const navigationDialog = page.getByRole('dialog', { name: 'Leave booking?' })
  await expect(navigationDialog).toContainText('Are you sure you want to leave the booking screen?')
  await navigationDialog.getByRole('button', { name: 'Stay on this page' }).click()

  await expect(page.getByRole('heading', { name: 'Tell us what you need.' })).toBeVisible()
  await expect(waterService).toBeChecked()
  await page.getByRole('button', { name: 'Urban Tanker home' }).click()
  await page.getByRole('dialog', { name: 'Leave booking?' }).getByRole('button', { name: 'Leave booking' }).click()
  await expect(page.getByRole('navigation', { name: 'customer workspace pages' })).toBeVisible()
})

test('signed-in customer is asked before leaving or refreshing an empty booking screen', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('urban-tanker-auth', JSON.stringify({
      state: { user: { username: 'customer@example.com', name: 'Test Customer', role: 'customer' } },
      version: 0,
    }))
  })
  await mockBookingApi(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'My Bookings' }).click()
  await page.getByRole('button', { name: 'Book now', exact: true }).click()
  await expect(page.getByRole('heading', { name: '0 services' })).toBeVisible()

  await page.getByRole('button', { name: 'Urban Tanker home' }).click()
  const navigationDialog = page.getByRole('dialog', { name: 'Leave booking?' })
  await expect(navigationDialog).toBeVisible()
  await navigationDialog.getByRole('button', { name: 'Stay on this page' }).click()
  await expect(page.getByRole('heading', { name: 'Tell us what you need.' })).toBeVisible()

  let refreshPrompt = ''
  page.once('dialog', (dialog) => {
    refreshPrompt = dialog.type()
    void dialog.accept()
  })
  await page.reload()
  expect(refreshPrompt).toBe('beforeunload')
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
