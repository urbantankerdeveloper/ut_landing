import { beforeAll, describe, expect, it } from 'vitest'
import { bookingSchema } from '../../lib/schemas.js'
import {
  BENCH_EMAIL_DOMAIN,
  BOOKING_STATUSES,
  DISCOUNT_TYPES,
  DOCUMENT_VERIFICATION,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  SCALES,
  SEED_TABLE_ORDER,
  TABLE_COLUMNS,
  USER_ROLES,
  VENDOR_VERIFICATION,
  WALLET_STATUSES,
  WALLET_TYPES,
  buildBenchQuoteBody,
  generateSeedData,
  mulberry32,
  type Row,
  type SeedData,
  type SeedTable,
} from './generate.js'

const NOW = new Date('2026-11-03T06:00:00.000Z')
const PASSWORD = 'bench-pass-123'
const DAY_MS = 86_400_000
const IST_OFFSET_MS = 19_800_000
const NATIONAL_PHONE = /^[6-9]\d{9}$/
const E164_PHONE = /^\+91[6-9]\d{9}$/

function build(seed = 42, now: Date = NOW): SeedData {
  return generateSeedData({ seed, scale: SCALES.small, now, password: PASSWORD })
}

let data: SeedData

beforeAll(() => {
  data = build()
})

function rows(table: SeedTable): Row[] {
  return data.tables[table]
}

function column(table: SeedTable, name: string): unknown[] {
  return rows(table).map((row) => row[name])
}

function idSet(table: SeedTable, name = 'id'): Set<unknown> {
  return new Set(column(table, name))
}

function expectUnique(values: unknown[], label: string): void {
  expect(new Set(values).size, `${label} must be unique`).toBe(values.length)
}

function expectReferences(table: SeedTable, name: string, target: Set<unknown>, nullable = false): void {
  for (const value of column(table, name)) {
    if (value === null && nullable) continue
    expect(target.has(value), `${table}.${name} must point at an existing row`).toBe(true)
  }
}

const PHONE_FIELDS: Array<[SeedTable, string]> = [
  ['profiles', 'phone_e164'],
  ['vendors', 'phone_e164'],
  ['drivers', 'mobile_e164'],
  ['bookings', 'customer_phone_e164'],
  ['auth.users', 'phone'],
]

describe('determinism', () => {
  it('gives identical output for the same seed and clock', () => {
    const again = build()
    expect(JSON.stringify(again.tables)).toBe(JSON.stringify(data.tables))
    expect(again.manifest).toEqual(data.manifest)
  })

  it('changes the output when the seed changes', () => {
    const other = build(43)
    expect(column('bookings', 'reference')).not.toEqual(other.tables.bookings.map((row) => row.reference))
  })

  it('produces the same PRNG sequence for the same seed', () => {
    const first = mulberry32(7)
    const second = mulberry32(7)
    for (let i = 0; i < 100; i++) {
      const value = first()
      expect(value).toBe(second())
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('row counts match the scale', () => {
  it('creates customers, vendor owners and the two staff profiles', () => {
    const roles = rows('profiles').reduce<Record<string, number>>((acc, row) => {
      const role = String(row.role)
      acc[role] = (acc[role] ?? 0) + 1
      return acc
    }, {})
    expect(roles).toEqual({ customer: 500, vendor: 50, admin: 1, dispatcher: 1 })
    expect(rows('auth.users')).toHaveLength(rows('profiles').length)
  })

  it('creates the vendor, booking and per-booking child counts', () => {
    expect(rows('vendors')).toHaveLength(SCALES.small.vendors)
    expect(rows('bookings')).toHaveLength(SCALES.small.bookings)
    expect(rows('notifications')).toHaveLength(3 * SCALES.small.bookings)
    expect(rows('analytics_events')).toHaveLength(SCALES.small.bookings)
    const events = rows('booking_events').length
    expect(events).toBeGreaterThanOrEqual(SCALES.small.bookings)
    expect(events).toBeLessThanOrEqual(5 * SCALES.small.bookings)
  })

  it('creates payments and invoices only for delivered bookings', () => {
    const delivered = rows('bookings').filter((row) => row.status === 'delivered').length
    expect(delivered).toBeGreaterThan(0)
    expect(rows('payments')).toHaveLength(delivered)
    expect(rows('invoices')).toHaveLength(delivered)
  })

  it('gives wallet transactions to 20 percent of customers', () => {
    const walletCustomers = new Set(column('wallet_transactions', 'customer_id'))
    expect(walletCustomers.size).toBe(SCALES.small.customers / 5)
  })

  it('gives one document per vehicle and per driver', () => {
    expect(rows('documents')).toHaveLength(rows('vehicles').length + rows('drivers').length)
  })

  it('gives every vendor one to four vehicles and one to four drivers', () => {
    for (const table of ['vehicles', 'drivers'] as const) {
      const counts = new Map<unknown, number>()
      for (const row of rows(table)) counts.set(row.vendor_id, (counts.get(row.vendor_id) ?? 0) + 1)
      expect(counts.size).toBe(SCALES.small.vendors)
      for (const count of counts.values()) {
        expect(count).toBeGreaterThanOrEqual(1)
        expect(count).toBeLessThanOrEqual(4)
      }
    }
  })

  it('creates the catalog, coupons, feature flags and plans', () => {
    expect(rows('service_catalog')).toHaveLength(6)
    expect(rows('coupons')).toHaveLength(20)
    expect(rows('configs')).toHaveLength(10)
    expect(rows('membership_plans')).toHaveLength(3)
  })

  it('has some expired coupons', () => {
    const expired = rows('coupons').filter((row) => new Date(String(row.valid_until)).getTime() < NOW.getTime())
    expect(expired.length).toBeGreaterThan(0)
  })

  it('gives about 70 percent of bookings a vendor', () => {
    const withVendor = rows('bookings').filter((row) => row.vendor_id !== null).length
    const share = withVendor / rows('bookings').length
    expect(share).toBeGreaterThan(0.65)
    expect(share).toBeLessThan(0.75)
  })
})

describe('foreign keys point at generated rows', () => {
  it('links profiles, vendors, vehicles, drivers and documents', () => {
    expectReferences('profiles', 'id', idSet('auth.users'))
    expectReferences('vendors', 'owner_profile_id', idSet('profiles'))
    expectReferences('vehicles', 'vendor_id', idSet('vendors'))
    expectReferences('drivers', 'vendor_id', idSet('vendors'))
    expectReferences('documents', 'reviewed_by', idSet('profiles'), true)
    const vehicleIds = idSet('vehicles')
    const driverIds = idSet('drivers')
    for (const doc of rows('documents')) {
      const target = doc.owner_type === 'vehicle' ? vehicleIds : driverIds
      expect(target.has(doc.owner_id)).toBe(true)
    }
  })

  it('links bookings and their children', () => {
    expectReferences('bookings', 'customer_id', idSet('profiles'))
    expectReferences('bookings', 'vendor_id', idSet('vendors'), true)
    expectReferences('bookings', 'vehicle_id', idSet('vehicles'), true)
    expectReferences('bookings', 'driver_id', idSet('drivers'), true)
    expectReferences('bookings', 'service_code', new Set(column('service_catalog', 'code')))
    expectReferences('booking_events', 'booking_id', idSet('bookings'))
    expectReferences('booking_events', 'actor_id', idSet('profiles'), true)
    expectReferences('payments', 'booking_id', idSet('bookings'))
    expectReferences('invoices', 'booking_id', idSet('bookings'))
    expectReferences('invoices', 'customer_id', idSet('profiles'))
    expectReferences('notifications', 'recipient_id', idSet('profiles'))
    expectReferences('wallet_transactions', 'customer_id', idSet('profiles'))
  })

  it('keeps each booking vehicle and driver with the booking vendor', () => {
    const vehicleVendor = new Map(rows('vehicles').map((row) => [row.id, row.vendor_id]))
    const driverVendor = new Map(rows('drivers').map((row) => [row.id, row.vendor_id]))
    for (const booking of rows('bookings')) {
      if (booking.vehicle_id) expect(vehicleVendor.get(booking.vehicle_id)).toBe(booking.vendor_id)
      if (booking.driver_id) expect(driverVendor.get(booking.driver_id)).toBe(booking.vendor_id)
    }
  })

  it('copies each booking customer phone from the customer profile', () => {
    const phoneByProfile = new Map(rows('profiles').map((row) => [row.id, row.phone_e164]))
    for (const booking of rows('bookings')) {
      expect(booking.customer_phone_e164).toBe(phoneByProfile.get(booking.customer_id))
    }
  })
})

describe('uniqueness', () => {
  it('keeps booking references and tracking-token hashes unique', () => {
    expectUnique(column('bookings', 'reference'), 'booking reference')
    expectUnique(column('bookings', 'tracking_token_hash'), 'tracking_token_hash')
    for (const reference of column('bookings', 'reference')) {
      expect(String(reference)).toMatch(/^UT-[0-9A-F]{10}$/)
    }
    for (const hash of column('bookings', 'tracking_token_hash')) {
      expect(String(hash)).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('keeps ids unique within every table that has an id', () => {
    for (const table of SEED_TABLE_ORDER) {
      if (!TABLE_COLUMNS[table].some(([name]) => name === 'id')) continue
      expectUnique(column(table, 'id'), `${table}.id`)
    }
  })

  it('keeps phones, emails and usernames unique', () => {
    expectUnique(column('profiles', 'phone_e164'), 'profile phone')
    expectUnique(column('auth.users', 'email'), 'auth email')
    expectUnique(column('profiles', 'email'), 'profile email')
    const usernames = column('profiles', 'username').filter((value) => value !== null)
    expectUnique(usernames.map((value) => String(value).toLowerCase()), 'username')
    expect(usernames).toHaveLength(SCALES.small.customers / 10)
  })

  it('keeps registration numbers, licence numbers, coupon codes and invoice numbers unique', () => {
    expectUnique(column('vehicles', 'registration_number'), 'registration_number')
    expectUnique(column('drivers', 'licence_number'), 'licence_number')
    expectUnique(column('coupons', 'code'), 'coupon code')
    expectUnique(column('invoices', 'number'), 'invoice number')
    expectUnique(column('service_catalog', 'code'), 'service code')
  })
})

describe('phone numbers and coordinates', () => {
  it('stores every phone as E.164 with exactly 10 national digits starting 6 to 9', () => {
    for (const [table, name] of PHONE_FIELDS) {
      for (const value of column(table, name)) {
        if (value === null) continue
        const text = String(value)
        expect(text, `${table}.${name}`).toMatch(E164_PHONE)
        const national = text.slice(3)
        expect(national).toMatch(/^\d{10}$/)
        expect(national).toMatch(NATIONAL_PHONE)
      }
    }
  })

  it('places vendors and bookings inside the India box', () => {
    for (const table of ['vendors', 'bookings'] as const) {
      for (const row of rows(table)) {
        const latitude = row.latitude
        const longitude = row.longitude
        expect(latitude === null).toBe(longitude === null)
        if (latitude === null || longitude === null) continue
        expect(Number(latitude)).toBeGreaterThanOrEqual(8)
        expect(Number(latitude)).toBeLessThanOrEqual(35)
        expect(Number(longitude)).toBeGreaterThanOrEqual(68)
        expect(Number(longitude)).toBeLessThanOrEqual(97)
      }
    }
  })
})

describe('status and verification values match the schema', () => {
  it('uses only the allowed booking statuses and covers the whole lifecycle', () => {
    const statuses = new Set(column('bookings', 'status'))
    for (const status of statuses) expect(BOOKING_STATUSES).toContain(status)
    for (const status of BOOKING_STATUSES) expect(statuses.has(status), `status ${status} present`).toBe(true)
  })

  it('keeps booking events as a chain that ends at the booking status', () => {
    const byBooking = new Map<unknown, Row[]>()
    for (const event of rows('booking_events')) {
      const list = byBooking.get(event.booking_id) ?? []
      list.push(event)
      byBooking.set(event.booking_id, list)
    }
    const statusByBooking = new Map(rows('bookings').map((row) => [row.id, row.status]))
    for (const [bookingId, events] of byBooking) {
      expect(events[0]?.from_status).toBeNull()
      for (let i = 1; i < events.length; i++) {
        expect(events[i]?.from_status).toBe(events[i - 1]?.to_status)
      }
      expect(events[events.length - 1]?.to_status).toBe(statusByBooking.get(bookingId))
    }
  })

  it('uses only the allowed verification, role and payment values', () => {
    for (const table of ['vendors', 'vehicles', 'drivers'] as const) {
      for (const value of column(table, 'verification')) expect(VENDOR_VERIFICATION).toContain(value)
    }
    for (const value of column('documents', 'verification')) expect(DOCUMENT_VERIFICATION).toContain(value)
    const reviewedRows = rows('documents').filter((row) => row.verification === 'approved' || row.verification === 'rejected')
    for (const row of reviewedRows) expect(row.reviewed_by).not.toBeNull()
    for (const value of column('profiles', 'role')) expect(USER_ROLES).toContain(value)
    for (const value of column('wallet_transactions', 'type')) expect(WALLET_TYPES).toContain(value)
    for (const value of column('wallet_transactions', 'status')) expect(WALLET_STATUSES).toContain(value)
    for (const value of column('payments', 'status')) expect(PAYMENT_STATUSES).toContain(value)
    for (const value of column('coupons', 'discount_type')) expect(DISCOUNT_TYPES).toContain(value)
    for (const value of column('bookings', 'payment_method')) expect(PAYMENT_METHODS).toContain(value)
    for (const value of column('profiles', 'signup_platform')) expect([null, 'web', 'mobile']).toContain(value)
    for (const value of column('profiles', 'theme_mode')) expect(['light', 'dark', 'system']).toContain(value)
    for (const value of column('bookings', 'customer_type')) expect(value).toBe('registered')
  })

  it('keeps cancellation reasons and delivery OTPs to the statuses that use them', () => {
    for (const booking of rows('bookings')) {
      if (booking.status === 'cancelled') expect(String(booking.cancellation_reason).length).toBeGreaterThanOrEqual(2)
      else expect(booking.cancellation_reason).toBeNull()
      const hasOtp = booking.delivery_otp_hash !== null
      expect(hasOtp).toBe(booking.status === 'en_route' || booking.status === 'arrived')
      expect(booking.delivery_otp_attempts).toBe(0)
    }
  })

  it('gives analytics events valid names and session ids', () => {
    for (const row of rows('analytics_events')) {
      expect(String(row.event_name)).toMatch(/^[a-z0-9._-]{2,80}$/)
      expect(String(row.session_id)).toMatch(/^[a-zA-Z0-9._:-]{8,120}$/)
    }
  })
})

describe('accounts and manifest', () => {
  it('uses lowercase bench emails and usernames that the API accepts', () => {
    const emails = [...column('auth.users', 'email'), ...column('profiles', 'email')]
    for (const email of emails) {
      expect(String(email)).toBe(String(email).toLowerCase())
      expect(String(email)).toMatch(new RegExp(`^[a-z0-9._-]+@${BENCH_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`))
    }
    for (const row of rows('profiles')) {
      if (row.username === null) continue
      expect(String(row.username)).toMatch(/^[a-zA-Z0-9._-]{3,40}$/)
    }
  })

  it('stores the bench password in the placeholder format and matches each profile role', () => {
    const roleById = new Map(rows('profiles').map((row) => [row.id, row.role]))
    for (const user of rows('auth.users')) {
      expect(user.encrypted_password).toBe(`bench:${PASSWORD}`)
      expect(user.aud).toBe('authenticated')
      const appMeta = user.raw_app_meta_data as { role?: string }
      expect(appMeta.role).toBe(roleById.get(user.id))
    }
  })

  it('makes every vendor owner a vendor profile', () => {
    const roleById = new Map(rows('profiles').map((row) => [row.id, row.role]))
    for (const vendor of rows('vendors')) expect(roleById.get(vendor.owner_profile_id)).toBe('vendor')
  })

  it('gives the manifest a customer with a username, a vendor, an open booking and admin credentials', () => {
    const manifest = data.manifest
    const customer = rows('profiles').find((row) => row.username === manifest.BENCH_CUSTOMER_USERNAME)
    expect(customer?.role).toBe('customer')
    expect(customer?.email).toBe(manifest.BENCH_CUSTOMER_EMAIL)
    expect(manifest.BENCH_CUSTOMER_PASSWORD).toBe(PASSWORD)

    const vendor = rows('vendors').find((row) => row.id === manifest.BENCH_VENDOR_ID)
    expect(vendor?.verification).toBe('approved')
    expect(manifest.BENCH_VENDOR_EMAIL).toMatch(/^vendor-/)

    const booking = rows('bookings').find((row) => row.id === manifest.BENCH_OPEN_BOOKING_ID)
    expect(booking).toBeDefined()
    expect(['delivered', 'cancelled']).not.toContain(booking?.status)

    expect(manifest.BENCH_ADMIN_EMAIL).toMatch(/^admin-/)
    expect(manifest.BENCH_ADMIN_PASSWORD).toBe(PASSWORD)
  })

  it('builds a quote body that bookingSchema accepts and that names a real active service', () => {
    const fresh = build(42, new Date())
    const body = JSON.parse(fresh.manifest.BENCH_QUOTE_BODY) as Record<string, unknown>
    const parsed = bookingSchema.safeParse(body)
    expect(parsed.success).toBe(true)
    expect(body.paymentMethod).toBe('cod')
    const services = body.services as Array<{ serviceId: string; deliveryDate: string }>
    const codes = column('service_catalog', 'code')
    expect(codes).toContain(services[0]?.serviceId)
    const expected = new Date(Date.now() + IST_OFFSET_MS + 10 * DAY_MS).toISOString().slice(0, 10)
    expect(services[0]?.deliveryDate).toBe(expected)
  })

  it('builds the quote body from its inputs', () => {
    const body = JSON.parse(buildBenchQuoteBody(NOW, 'water_tanker', '1000 litres', 'Kurla, Mumbai')) as Record<string, unknown>
    expect(body).toEqual({
      services: [{ serviceId: 'water_tanker', capacity: '1000 litres', deliveryDate: '2026-11-13' }],
      location: 'Kurla, Mumbai',
      paymentMethod: 'cod',
    })
  })
})

describe('timestamps', () => {
  it('spreads most bookings over the last 180 days and schedules some in the future', () => {
    const earliest = NOW.getTime() - 180 * DAY_MS
    for (const booking of rows('bookings')) {
      const created = new Date(String(booking.created_at)).getTime()
      expect(created).toBeGreaterThanOrEqual(earliest)
      expect(created).toBeLessThanOrEqual(NOW.getTime())
    }
    const future = rows('bookings').filter((row) => new Date(String(row.scheduled_for)).getTime() > NOW.getTime())
    expect(future.length).toBeGreaterThan(0)
  })
})

describe('row shape', () => {
  it('has exactly the schema column names in every row', () => {
    for (const table of SEED_TABLE_ORDER) {
      const expected = TABLE_COLUMNS[table].map(([name]) => name).sort()
      for (const row of rows(table)) {
        expect(Object.keys(row).sort(), table).toEqual(expected)
      }
    }
  })
})
