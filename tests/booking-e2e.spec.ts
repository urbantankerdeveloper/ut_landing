import { expect, test, type Page, type Route } from '@playwright/test'

const services = [
  { code: 'water_tanker', name: 'Water tanker', description: 'Reliable supply', base_price_paise: 250000, is_active: true },
  { code: 'tank_cleaning', name: 'Tank cleaning', description: 'Tank cleaning', base_price_paise: 180000, is_active: true },
]
const offers = [
  { id: 'offer-1', code: 'WELCOME10', title: 'Welcome discount', discount_type: 'percentage', discount_value: 10, is_active: true },
  { id: 'offer-2', code: 'WATER15', title: 'Water service offer', discount_type: 'percentage', discount_value: 15, is_active: true },
]

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
  await page.route('**/api/customer/addresses', fulfill([]))
  await page.route('**/api/customer/phone-verification', fulfill({ phone: '9876543210', verified: verifiedPhone }))
  await page.route('**/api/customer/services', fulfill(services))
  await page.route('**/api/customer/offers', fulfill(offers))
  await page.route('**/api/customer/coupons/validate', fulfill({ valid: true, coupon: { discount_type: 'percentage', discount_value: 10 } }))
  await page.route('**/api/customer/orders/quote', route => {
    const payload = route.request().postDataJSON() as Record<string, unknown>
    bookingPayloads.push(payload)
    return fulfill({ id: 'booking-1', quotedAmountPaise: payload.couponCode ? 270000 : 295000 })(route)
  })
  return bookingPayloads
}

async function completeBookingDetails(page: Page, applyCoupon = false) {
  await page.getByRole('button', { name: /Book now|Start a new booking/ }).first().click()
  await page.locator('.booking-line').first().getByLabel('Water type').selectOption('Construction water')
  await page.getByRole('textbox', { name: 'Customer / company name' }).fill('Test Customer')
  await page.getByRole('textbox', { name: 'Full address' }).fill('MG Road, Chennai')
  await page.getByLabel('Required date').fill('2026-11-20')
  await page.getByLabel('Preferred time').selectOption('07:00')
  await expect(page.getByRole('button', { name: 'Scroll coupons left' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Scroll coupons right' })).toBeVisible()
  await expect(page.locator('.booking-coupon-card')).toHaveCount(2)
  if (applyCoupon) await page.getByRole('button', { name: /WELCOME10/ }).click()
  await page.getByRole('textbox', { name: /Mobile number/ }).fill('9876543210')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByRole('textbox', { name: 'Mobile verification code' }).fill('123456')
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByText('Mobile number verified. It can be used for all selected services.')).toBeVisible()
  await page.getByRole('button', { name: /Review combined booking/ }).click()
  await page.getByRole('checkbox', { name: /I confirm these requirements/ }).check()
  await page.getByRole('button', { name: /Continue to payment/ }).click()
}

test('guest can verify mocked OTP and complete COD booking without leaving payment', async ({ page }) => {
  await mockBookingApi(page)

  await page.goto('/')
  await completeBookingDetails(page, true)

  await expect(page.locator('.booking-price-total')).toContainText('2,700')
  await expect(page.getByText('This shared number is verified and will receive booking updates and delivery OTPs.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Choose how to pay.' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Confirm booking · INR 2,700/ })).toBeVisible()
  await page.getByRole('radio', { name: /Cash on delivery/ }).check()
  await page.getByRole('button', { name: /Confirm booking/ }).click()
  await expect(page.getByRole('heading', { name: 'Your combined booking is ready.' })).toBeVisible()
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
  await expect(page.getByRole('heading', { name: 'Your combined booking is ready.' })).toBeVisible()
})

test('registered customer can select a saved address and save a new one during booking', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('urban-tanker-auth', JSON.stringify({
      state: { user: { username: 'customer@example.com', name: 'Test Customer', role: 'customer' } },
      version: 0,
    }))
  })
  await mockBookingApi(page, true)
  let savedAddress: Record<string, unknown> | undefined
  await page.route('**/api/customer/addresses', async (route) => {
    if (route.request().method() === 'POST') {
      savedAddress = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'address-2', ...savedAddress }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'address-1', label: 'Site', address: 'T Nagar', city: 'Chennai', pincode: '600017' }]) })
  })

  await page.goto('/')
  await page.getByRole('button', { name: /Book now|Start a new booking/ }).first().click()
  await page.getByRole('combobox', { name: 'Use a saved address' }).selectOption('address-1')
  await expect(page.getByText('T Nagar, Chennai 600017')).toBeVisible()
  await page.getByRole('combobox', { name: 'Use a saved address' }).selectOption('')
  await page.getByRole('textbox', { name: 'Full address' }).fill('MG Road, Chennai')
  await page.getByRole('textbox', { name: 'Address label' }).fill('Project site')
  await page.getByRole('checkbox', { name: /Save this address to my account/ }).check()
  await page.getByRole('textbox', { name: 'City' }).fill('Chennai')
  await page.getByRole('textbox', { name: 'Pincode' }).fill('600001')
  await page.getByRole('button', { name: /Review combined booking/ }).click()
  await page.getByRole('checkbox', { name: /I confirm these requirements/ }).check()
  await page.getByRole('button', { name: /Continue to payment/ }).click()
  await page.getByRole('radio', { name: /Cash on delivery/ }).check()
  await page.getByRole('button', { name: /Confirm booking/ }).click()

  await expect(page.getByRole('heading', { name: 'Your combined booking is ready.' })).toBeVisible()
  expect(savedAddress).toEqual({ label: 'Project site', address: 'MG Road, Chennai', city: 'Chennai', pincode: '600001' })
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

test('service items can be added separately and removed independently', async ({ page }) => {
  await mockBookingApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Book now|Start a new booking/ }).first().click()
  await expect(page.locator('.booking-line')).toHaveCount(1)
  const tankerCount = page.getByRole('spinbutton', { name: /Number of tankers/ })
  await expect(tankerCount).toHaveAttribute('max', '5')
  await tankerCount.fill('6')
  expect(await tankerCount.evaluate((input) => !(input as HTMLInputElement).validity.valid)).toBe(true)
  await tankerCount.fill('5')
  expect(await tankerCount.evaluate((input) => (input as HTMLInputElement).validity.valid)).toBe(true)
  await expect(page.getByRole('textbox', { name: 'Required date' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Full address' })).toBeVisible()

  await page.getByRole('button', { name: 'Add another service' }).click()
  await expect(page.locator('.booking-line')).toHaveCount(2)
  await page.locator('.booking-line').nth(1).getByLabel('Service for item 2').selectOption('tank_cleaning')
  await expect(page.getByLabel('Service for item 1')).toBeVisible()
  await expect(page.getByLabel('Service for item 2')).toHaveValue('tank_cleaning')
  await page.getByRole('button', { name: 'Remove service item 2' }).click()
  await expect(page.locator('.booking-line')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Remove service item 1' })).toBeVisible()
})

test('customer can remove every service item and explicitly add another later', async ({ page }) => {
  await mockBookingApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Book now|Start a new booking/ }).first().click()
  await page.getByRole('button', { name: 'Add another service' }).click()
  await expect(page.locator('.booking-line')).toHaveCount(2)

  await page.getByRole('button', { name: 'Remove all services' }).click()
  const confirmation = page.getByRole('group', { name: 'Confirm removing all services' })
  await expect(confirmation).toContainText('Remove all 2 service items?')
  await confirmation.getByRole('button', { name: 'Remove all' }).click()
  await expect(page.locator('.booking-line')).toHaveCount(0)
  await expect(page.getByText('Select at least one service to enter delivery and contact details.')).toBeVisible()

  await page.getByRole('button', { name: 'Add another service' }).click()
  await expect(page.locator('.booking-line')).toHaveCount(1)
})

test('out-of-service locations show a toast and require a Chennai location', async ({ page }) => {
  await mockBookingApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Book now' }).first().click()
  const locationInput = page.getByRole('textbox', { name: 'Full address' })
  await locationInput.fill('Erode, Tamil Nadu')
  await locationInput.press('Tab')
  await expect(page.getByRole('alert').filter({ hasText: 'We currently deliver only within Chennai.' })).toBeVisible()

  await locationInput.fill('T Nagar, Chennai')
  await locationInput.press('Tab')
  await expect(page.getByRole('alert').filter({ hasText: 'We currently deliver only within Chennai.' })).toHaveCount(0)
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
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const pastDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
  await page.getByRole('textbox', { name: 'Required date' }).fill(pastDate)
  await page.getByRole('textbox', { name: 'Full address' }).fill('MG Road, Chennai')
  await page.getByRole('textbox', { name: /Mobile number/ }).fill('9876543210')
  const reviewButton = page.getByRole('button', { name: /Review combined booking/ })
  await expect(reviewButton).toBeDisabled()
  await page.getByRole('textbox', { name: 'Required date' }).fill(futureDateInputValue())
  await expect(reviewButton).toBeEnabled()
})

test('shared address and date gate review for every service item', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('urban-tanker-auth', JSON.stringify({
      state: { user: { username: 'customer@example.com', name: 'Test Customer', role: 'customer' } },
      version: 0,
    }))
  })
  await mockBookingApi(page, true)
  await page.goto('/')
  await page.getByRole('button', { name: /Book now|Start a new booking/ }).first().click()
  await page.getByRole('button', { name: 'Add another service' }).click()
  await page.locator('.booking-line').nth(1).getByLabel('Service for item 2').selectOption('tank_cleaning')
  const reviewButton = page.getByRole('button', { name: /Review combined booking/ })
  await expect(reviewButton).toBeDisabled()
  await page.getByRole('textbox', { name: 'Required date' }).fill(futureDateInputValue())
  await page.getByRole('textbox', { name: 'Full address' }).fill('MG Road, Chennai')
  await expect(page.getByRole('textbox', { name: 'Mobile number' })).toHaveValue('9876543210')
  await expect(page.getByText('Mobile number verified. It can be used for all selected services.')).toBeVisible()
  await expect(reviewButton).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'One booking. Every service you need.' })).toBeVisible()
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
  await page.getByRole('button', { name: 'Add another service' }).click()
  await page.locator('.booking-line').nth(1).getByLabel('Service for item 2').selectOption('tank_cleaning')
  await page.locator('.booking-line').nth(0).getByLabel('Water type').selectOption('Raw water')
  await page.locator('.booking-line').nth(0).getByLabel('Capacity').selectOption('6 KL')
  await page.locator('.booking-line').nth(1).getByLabel('Tank type').selectOption('Sump')
  await page.locator('.booking-line').nth(1).getByLabel('Number of tanks').fill('2')
  await page.getByLabel('Required date').fill('2026-11-20')
  await page.getByLabel('Preferred time').selectOption('10:00')
  await page.getByRole('textbox', { name: 'Customer / company name' }).fill('Test Customer')
  await page.getByRole('textbox', { name: 'Full address' }).fill('MG Road, Chennai')
  await page.getByRole('textbox', { name: /Mobile number/ }).fill('9876543210')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByRole('textbox', { name: 'Mobile verification code' }).fill('123456')
  await page.getByRole('button', { name: 'Verify' }).click()
  await page.getByRole('button', { name: /Review combined booking/ }).click()
  await page.getByRole('checkbox', { name: /I confirm these requirements/ }).check()
  await page.getByRole('button', { name: /Continue to payment/ }).click()
  await page.getByRole('radio', { name: /Cash on delivery/ }).check()
  await page.getByRole('button', { name: /Confirm booking/ }).click()

  await expect(page.getByRole('heading', { name: 'Your combined booking is ready.' })).toBeVisible()
  await expect(page.getByRole('banner').getByRole('button', { name: 'My Account', exact: true })).toBeVisible()
  await page.getByRole('banner').getByRole('button', { name: 'My Account', exact: true }).click()
  await page.getByRole('dialog', { name: 'Leave booking?' }).getByRole('button', { name: 'Leave booking' }).click()
  await expect(page.getByRole('button', { name: 'My Bookings' })).toBeVisible()
  expect(bookingPayloads).toHaveLength(1)
  expect(bookingPayloads[0].serviceId).toBe('water_tanker')
  expect(bookingPayloads[0].phone).toBe('9876543210')
  expect(bookingPayloads[0].phoneVerificationChallengeId).toBe('00000000-0000-4000-8000-000000000001')
  const submittedServices = bookingPayloads[0].services as Record<string, unknown>[]
  expect(submittedServices).toHaveLength(2)
  expect(submittedServices.map((service) => service.serviceId)).toEqual(['water_tanker', 'tank_cleaning'])
  expect(submittedServices.map((service) => service.deliveryDate)).toEqual(['2026-11-20', '2026-11-20'])
  expect(submittedServices.map((service) => service.location)).toEqual([
    'MG Road, Chennai, South Chennai',
    'MG Road, Chennai, South Chennai',
  ])
  expect(submittedServices[0].waterType).toBe('Raw water')
  expect(submittedServices[1].serviceType).toBe('Sump')
  expect(submittedServices[1].quantity).toBe('2')
  expect(bookingPayloads[0].preferredTime).toBe('10:00')
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
  await page.getByRole('textbox', { name: 'Full address' }).fill('MG Road, Chennai')
  await page.getByRole('textbox', { name: 'Required date' }).fill(futureDateInputValue())
  const mobileInput = page.getByRole('textbox', { name: 'Mobile number' })
  await expect(mobileInput).toHaveValue('9876543210')
  await mobileInput.fill('123')
  await expect(page.getByRole('button', { name: /Review combined booking/ })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Mobile verification code' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'One booking. Every service you need.' })).toBeVisible()
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
  await expect(page.getByRole('heading', { name: 'One booking. Every service you need.' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Book now', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'One booking. Every service you need.' })).toBeVisible()
  await page.getByRole('banner').getByRole('button', { name: 'My Account', exact: true }).click()
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
  await expect(page.getByRole('heading', { name: 'One booking. Every service you need.' })).toBeVisible()
  await expect(page.locator('.booking-line')).toHaveCount(2)
  await expect(page.getByRole('textbox', { name: 'Full address' })).toHaveValue('MG Road, Chennai')
  await expect(page.getByRole('textbox', { name: 'Required date' })).toHaveValue('2026-11-20')
  await expect(page.locator('.booking-line').nth(0).getByLabel('Capacity')).toHaveValue('5,000 litres')
  await expect(page.locator('.booking-line').nth(1).getByLabel('Tank type')).toHaveValue('Overhead tank')
  await expect(page.getByRole('textbox', { name: /Mobile number/ })).toHaveValue('9876543210')
  await expect(page.getByRole('textbox', { name: 'Additional requirements' })).toHaveValue('Use the north entrance')
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

  await expect(page.locator('.booking-line')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'One booking. Every service you need.' })).toBeVisible()

  await page.getByRole('banner').getByRole('button', { name: 'Urban Tanker home' }).click()
  const navigationDialog = page.getByRole('dialog', { name: 'Leave booking?' })
  await expect(navigationDialog).toContainText('Are you sure you want to leave the booking screen?')
  await navigationDialog.getByRole('button', { name: 'Stay on this page' }).click()

  await expect(page.getByRole('heading', { name: 'One booking. Every service you need.' })).toBeVisible()
  await expect(page.locator('.booking-line')).toHaveCount(1)
  await page.getByRole('banner').getByRole('button', { name: 'Urban Tanker home' }).click()
  await page.getByRole('dialog', { name: 'Leave booking?' }).getByRole('button', { name: 'Leave booking' }).click()
  await expect(page.getByRole('navigation', { name: 'customer workspace pages' })).toBeVisible()
})

test('signed-in customer is asked before leaving or refreshing the initial booking screen', async ({ page }) => {
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
  await expect(page.locator('.booking-line')).toHaveCount(1)

  await page.getByRole('banner').getByRole('button', { name: 'Urban Tanker home' }).click()
  const navigationDialog = page.getByRole('dialog', { name: 'Leave booking?' })
  await expect(navigationDialog).toBeVisible()
  await navigationDialog.getByRole('button', { name: 'Stay on this page' }).click()
  await expect(page.getByRole('heading', { name: 'One booking. Every service you need.' })).toBeVisible()

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
