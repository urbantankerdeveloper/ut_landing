// Deterministic synthetic data for the local benchmark seed (see src/scripts/seed-bench.ts).
//
// Pure: no database and no environment access. The same seed, scale, clock and password always give the same
// output. Row keys are exactly the column names in TABLE_COLUMNS, which mirror supabase/001 to 003.
//
// LOCAL BENCHMARK ONLY. Passwords are stored as 'bench:' + password. That is a placeholder format for the local
// auth mock, not a password hash. Never load this output into a real project.
//
// Must not import config.ts, database.ts or supabase.ts: those load backend/.env.local.

import { createHash } from 'node:crypto'

export type ScaleName = 'small' | 'medium'

export interface ScaleConfig {
  customers: number
  vendors: number
  bookings: number
}

export const SCALES: Record<ScaleName, ScaleConfig> = {
  small: { customers: 500, vendors: 50, bookings: 5_000 },
  medium: { customers: 5_000, vendors: 300, bookings: 100_000 },
}

export const BENCH_EMAIL_DOMAIN = 'bench.urbantanker.test'

// Allowed values, taken from the schema CHECK constraints and from the zod enums in src/routes.
export const BOOKING_STATUSES = ['pending_vendor', 'vendor_assigned', 'accepted', 'en_route', 'arrived', 'delivered', 'cancelled'] as const
export const USER_ROLES = ['customer', 'vendor', 'dispatcher', 'admin'] as const
// vendors, vehicles and drivers: verification enum in src/routes/vendor*.ts and admin routes
export const VENDOR_VERIFICATION = ['pending', 'approved', 'rejected', 'suspended'] as const
// documents: documents_verification_check in supabase/002
export const DOCUMENT_VERIFICATION = ['pending', 'submitted', 'approved', 'rejected'] as const
export const PAYMENT_METHODS = ['wallet', 'gateway', 'cod'] as const
export const WALLET_TYPES = ['credit', 'debit'] as const
export const WALLET_STATUSES = ['pending', 'completed', 'failed'] as const
export const PAYMENT_STATUSES = ['pending', 'paid', 'refunded', 'failed'] as const
export const DISCOUNT_TYPES = ['percentage', 'flat'] as const

export type BookingStatus = (typeof BOOKING_STATUSES)[number]
export type UserRole = (typeof USER_ROLES)[number]

export type PgType =
  | 'uuid' | 'text' | 'text[]' | 'jsonb' | 'timestamptz' | 'date' | 'numeric' | 'integer' | 'boolean'
  | 'char(3)' | 'public.user_role' | 'public.booking_status'

export type ColumnSpec = readonly [name: string, type: PgType]

// Column lists for every generated table. Only these columns are written, so defaults cover the rest.
export const TABLE_COLUMNS = {
  'auth.users': [
    ['id', 'uuid'], ['email', 'text'], ['encrypted_password', 'text'], ['phone', 'text'],
    ['raw_user_meta_data', 'jsonb'], ['raw_app_meta_data', 'jsonb'], ['aud', 'text'], ['role', 'text'],
    ['created_at', 'timestamptz'], ['email_confirmed_at', 'timestamptz'], ['updated_at', 'timestamptz'],
  ],
  membership_plans: [
    ['id', 'uuid'], ['name', 'text'], ['description', 'text'], ['amount', 'numeric'], ['billing_period', 'text'],
    ['benefits', 'jsonb'], ['is_active', 'boolean'], ['created_at', 'timestamptz'],
  ],
  service_catalog: [
    ['id', 'uuid'], ['code', 'text'], ['name', 'text'], ['description', 'text'], ['base_price_paise', 'integer'],
    ['is_active', 'boolean'], ['config', 'jsonb'],
  ],
  coupons: [
    ['id', 'uuid'], ['code', 'text'], ['title', 'text'], ['discount_type', 'text'], ['discount_value', 'numeric'],
    ['valid_until', 'timestamptz'], ['is_active', 'boolean'], ['created_at', 'timestamptz'],
  ],
  configs: [['key', 'text'], ['value', 'jsonb'], ['updated_at', 'timestamptz']],
  profiles: [
    ['id', 'uuid'], ['full_name', 'text'], ['phone_e164', 'text'], ['role', 'public.user_role'],
    ['created_at', 'timestamptz'], ['username', 'text'], ['signup_platform', 'text'], ['theme_mode', 'text'],
    ['email', 'text'], ['phone_verified_at', 'timestamptz'],
  ],
  vendors: [
    ['id', 'uuid'], ['owner_profile_id', 'uuid'], ['business_name', 'text'], ['phone_e164', 'text'],
    ['service_zone', 'text'], ['latitude', 'numeric'], ['longitude', 'numeric'], ['is_online', 'boolean'],
    ['verification', 'text'], ['created_at', 'timestamptz'],
  ],
  vehicles: [
    ['id', 'uuid'], ['vendor_id', 'uuid'], ['registration_number', 'text'], ['capacity_litres', 'integer'],
    ['supported_services', 'text[]'], ['is_active', 'boolean'], ['metadata', 'jsonb'], ['verification', 'text'],
  ],
  drivers: [
    ['id', 'uuid'], ['vendor_id', 'uuid'], ['name', 'text'], ['mobile_e164', 'text'], ['licence_number', 'text'],
    ['is_active', 'boolean'], ['verification', 'text'], ['metadata', 'jsonb'],
  ],
  documents: [
    ['id', 'uuid'], ['owner_type', 'text'], ['owner_id', 'uuid'], ['document_type', 'text'], ['object_key', 'text'],
    ['expires_on', 'date'], ['verification', 'text'], ['reviewed_by', 'uuid'], ['reviewed_at', 'timestamptz'],
    ['created_at', 'timestamptz'],
  ],
  bookings: [
    ['id', 'uuid'], ['reference', 'text'], ['customer_id', 'uuid'], ['customer_phone_e164', 'text'],
    ['customer_type', 'text'], ['idempotency_key', 'uuid'], ['vendor_id', 'uuid'], ['vehicle_id', 'uuid'],
    ['driver_id', 'uuid'], ['service_code', 'text'], ['capacity_litres', 'integer'], ['scheduled_for', 'timestamptz'],
    ['address_text', 'text'], ['latitude', 'numeric'], ['longitude', 'numeric'], ['access_notes', 'text'],
    ['cancellation_reason', 'text'], ['service_details', 'jsonb'], ['quoted_amount_paise', 'integer'],
    ['payment_method', 'text'], ['status', 'public.booking_status'], ['delivery_otp_hash', 'text'],
    ['delivery_otp_expires_at', 'timestamptz'], ['delivery_otp_attempts', 'integer'],
    ['tracking_token_hash', 'text'], ['tracking_token_expires_at', 'timestamptz'],
    ['created_at', 'timestamptz'], ['updated_at', 'timestamptz'],
  ],
  booking_events: [
    ['id', 'uuid'], ['booking_id', 'uuid'], ['actor_id', 'uuid'], ['from_status', 'public.booking_status'],
    ['to_status', 'public.booking_status'], ['note', 'text'], ['created_at', 'timestamptz'],
  ],
  payments: [
    ['id', 'uuid'], ['booking_id', 'uuid'], ['provider', 'text'], ['provider_order_id', 'text'],
    ['provider_payment_id', 'text'], ['amount_paise', 'integer'], ['currency', 'char(3)'], ['status', 'text'],
    ['created_at', 'timestamptz'],
  ],
  invoices: [
    ['id', 'uuid'], ['number', 'text'], ['customer_id', 'uuid'], ['booking_id', 'uuid'], ['service', 'text'],
    ['location', 'text'], ['amount', 'numeric'], ['status', 'text'], ['issued_at', 'timestamptz'],
  ],
  notifications: [
    ['id', 'uuid'], ['recipient_id', 'uuid'], ['event_type', 'text'], ['title', 'text'], ['payload', 'jsonb'],
    ['read_at', 'timestamptz'], ['created_at', 'timestamptz'],
  ],
  wallet_transactions: [
    ['id', 'uuid'], ['customer_id', 'uuid'], ['type', 'text'], ['amount', 'numeric'], ['status', 'text'],
    ['provider_reference', 'text'], ['created_at', 'timestamptz'],
  ],
  analytics_events: [
    ['id', 'uuid'], ['event_name', 'text'], ['session_id', 'text'], ['properties', 'jsonb'], ['created_at', 'timestamptz'],
  ],
} as const satisfies Record<string, readonly ColumnSpec[]>

export type SeedTable = keyof typeof TABLE_COLUMNS

// Parents before children, so foreign keys always point at rows already loaded.
export const SEED_TABLE_ORDER = [
  'auth.users', 'membership_plans', 'service_catalog', 'coupons', 'configs', 'profiles', 'vendors', 'vehicles',
  'drivers', 'documents', 'bookings', 'booking_events', 'payments', 'invoices', 'notifications',
  'wallet_transactions', 'analytics_events',
] as const satisfies readonly SeedTable[]

// Application tables that SEED_RESET truncates. Includes tables outside this generator that hold foreign keys to
// these rows, because TRUNCATE without CASCADE refuses to run otherwise. Never includes the auth schema.
export const RESET_TABLES = [
  'analytics_events', 'wallet_transactions', 'notifications', 'invoices', 'payments', 'booking_events', 'bookings',
  'documents', 'drivers', 'vehicles', 'vendor_location_updates', 'vendor_payouts', 'driver_attendance',
  'vendor_service_availability', 'dispatcher_alerts', 'ratings', 'vendors', 'profiles', 'saved_addresses',
  'subscriptions', 'complaints', 'device_tokens', 'audit_logs', 'customer_contracts', 'customer_memberships',
  'push_subscriptions', 'notification_preferences', 'offline_mutations', 'enquiries', 'coupon_redemptions',
  'partner_applications', 'coupons', 'service_catalog', 'membership_plans', 'configs',
] as const

export type Row = Record<string, unknown>
export type SeedTables = { [T in SeedTable]: Row[] }

// Env keys the benchmark runner reads. The manifest stores them under the same names.
export const MANIFEST_ENV_KEYS = [
  'BENCH_CUSTOMER_EMAIL', 'BENCH_CUSTOMER_PASSWORD', 'BENCH_CUSTOMER_USERNAME',
  'BENCH_VENDOR_EMAIL', 'BENCH_VENDOR_PASSWORD', 'BENCH_VENDOR_ID',
  'BENCH_ADMIN_EMAIL', 'BENCH_ADMIN_PASSWORD',
  'BENCH_OPEN_BOOKING_ID', 'BENCH_QUOTE_BODY',
] as const

export interface BenchManifest {
  generatedAt: string
  seed: number
  scale: ScaleConfig
  BENCH_CUSTOMER_EMAIL: string
  BENCH_CUSTOMER_PASSWORD: string
  BENCH_CUSTOMER_USERNAME: string
  BENCH_VENDOR_EMAIL: string
  BENCH_VENDOR_PASSWORD: string
  BENCH_VENDOR_ID: string
  BENCH_ADMIN_EMAIL: string
  BENCH_ADMIN_PASSWORD: string
  BENCH_OPEN_BOOKING_ID: string
  BENCH_QUOTE_BODY: string
}

export interface SeedData {
  tables: SeedTables
  manifest: BenchManifest
}

export interface GenerateOptions {
  seed: number
  scale: ScaleConfig
  // The clock. Pass the same value to reproduce the same output. Timestamps are relative to it.
  now: Date
  password: string
}

// ---------- PRNG and small helpers ----------

export type Rng = () => number

// mulberry32: a small 32-bit PRNG. Returns floats in [0, 1).
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000
// India is UTC+05:30 with no daylight saving.
const IST_OFFSET_MS = 19_800_000
const SLOT_HOURS_IST = [7, 10, 14, 18] as const
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ'.split('')
const STAFF_ID_PREFIX = { customer: '10000000', vendorOwner: '20000000', admin: '30000000', dispatcher: '40000000' } as const

function at<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`index ${index} is outside a list of ${items.length}`)
  return item
}

function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

function randFloat(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min)
}

function chance(rng: Rng, probability: number): boolean {
  return rng() < probability
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return at(items, Math.floor(rng() * items.length))
}

function weighted<T>(rng: Rng, entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let remaining = rng() * total
  for (const [value, weight] of entries) {
    remaining -= weight
    if (remaining < 0) return value
  }
  return at(entries, entries.length - 1)[0]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

function hexBytes(rng: Rng, bytes: number): string {
  let out = ''
  for (let i = 0; i < bytes; i++) out += randInt(rng, 0, 255).toString(16).padStart(2, '0')
  return out
}

// RFC 4122 version 4 layout, built from the PRNG so the same seed gives the same ids.
function uuidV4(rng: Rng): string {
  const hex = hexBytes(rng, 16)
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

// Account and staff ids do not depend on the seed, so re-running with a different seed reuses the same auth.users ids.
function fixedUuid(prefix: string, n: number): string {
  return `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

function uniqueValue(used: Set<string>, make: () => string): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const value = make()
    if (!used.has(value)) {
      used.add(value)
      return value
    }
  }
  throw new Error('could not generate a unique value')
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function istDate(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10)
}

// The first IST time slot (hour in IST) on the IST calendar day of ms.
function istSlotMs(ms: number, hourIst: number): number {
  const ist = new Date(ms + IST_OFFSET_MS)
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hourIst) - IST_OFFSET_MS
}

export function phoneDigits(rng: Rng): string {
  return `${randInt(rng, 6, 9)}${pad(randInt(rng, 0, 999_999_999), 9)}`
}

export function toE164(nationalDigits: string): string {
  return `+91${nationalDigits}`
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

// ---------- Reference data ----------

const FIRST_NAMES = [
  'Aarav', 'Vihaan', 'Arjun', 'Rohan', 'Kabir', 'Ishaan', 'Aditya', 'Rahul', 'Vikram', 'Sanjay', 'Ravi', 'Suresh',
  'Amit', 'Deepak', 'Manoj', 'Anil', 'Kiran', 'Naveen', 'Harish', 'Prakash', 'Meera', 'Ananya', 'Priya', 'Sneha',
  'Neha', 'Pooja', 'Kavya', 'Divya', 'Lakshmi', 'Sunita', 'Anjali', 'Ritu', 'Swati', 'Rekha', 'Asha', 'Geeta',
  'Nisha', 'Farhan', 'Imran', 'Zoya',
]
const LAST_NAMES = [
  'Sharma', 'Verma', 'Patel', 'Reddy', 'Iyer', 'Nair', 'Singh', 'Gupta', 'Kumar', 'Yadav', 'Mehta', 'Joshi',
  'Desai', 'Rao', 'Chauhan', 'Khan', 'Pillai', 'Menon', 'Das', 'Bose', 'Shah', 'Agarwal', 'Kulkarni', 'Naidu',
]
const BUSINESS_PREFIXES = [
  'Shree', 'Om', 'Sai', 'Ganesh', 'Kaveri', 'Ganga', 'Star', 'Jai', 'Maruti', 'Vishwa', 'Royal', 'Lakshmi', 'Urban',
]
const BUSINESS_SUFFIXES = [
  'Tankers', 'Water Services', 'Tank Care', 'Logistics', 'Borewell Works', 'Sewage Solutions', 'Transport Co',
]
const VEHICLE_MAKES = ['Tata', 'Ashok Leyland', 'Eicher', 'Mahindra']
const VEHICLE_CAPACITIES = [5000, 10000, 12000, 16000] as const
const CANCELLATION_REASONS = [
  'Vendor not reachable',
  'Address could not be located',
  'Customer requested a change of date',
  'Duplicate booking',
  'Water no longer required',
  'Vendor could not arrive in time',
]
const ACCESS_NOTES = [
  'Gate 2, call on arrival',
  'Basement parking, use the service lane',
  'Ring the bell at the ground floor',
  'Narrow lane, vehicle needs to reverse in',
]

interface City {
  name: string
  state: string
  lat: number
  lng: number
  localities: readonly string[]
}

const CITIES: readonly City[] = [
  { name: 'Mumbai', state: 'MH', lat: 19.076, lng: 72.8777, localities: ['Andheri East', 'Kurla', 'Chembur', 'Bandra West', 'Powai'] },
  { name: 'Pune', state: 'MH', lat: 18.5204, lng: 73.8567, localities: ['Hinjewadi', 'Kothrud', 'Viman Nagar', 'Hadapsar'] },
  { name: 'Nagpur', state: 'MH', lat: 21.1458, lng: 79.0882, localities: ['Dharampeth', 'Sitabuldi'] },
  { name: 'Delhi', state: 'DL', lat: 28.6139, lng: 77.209, localities: ['Dwarka', 'Rohini', 'Lajpat Nagar', 'Saket'] },
  { name: 'Gurugram', state: 'HR', lat: 28.4595, lng: 77.0266, localities: ['Sector 47', 'DLF Phase 3', 'Sohna Road'] },
  { name: 'Bengaluru', state: 'KA', lat: 12.9716, lng: 77.5946, localities: ['Whitefield', 'Koramangala', 'Yelahanka', 'Hebbal'] },
  { name: 'Hyderabad', state: 'TS', lat: 17.385, lng: 78.4867, localities: ['Gachibowli', 'Kukatpally', 'Madhapur'] },
  { name: 'Chennai', state: 'TN', lat: 13.0827, lng: 80.2707, localities: ['Tambaram', 'Velachery', 'Ambattur'] },
  { name: 'Ahmedabad', state: 'GJ', lat: 23.0225, lng: 72.5714, localities: ['Satellite', 'Naroda', 'Bopal'] },
  { name: 'Kolkata', state: 'WB', lat: 22.5726, lng: 88.3639, localities: ['Salt Lake', 'Howrah', 'New Town'] },
  { name: 'Jaipur', state: 'RJ', lat: 26.9124, lng: 75.7873, localities: ['Mansarovar', 'Vaishali Nagar'] },
  { name: 'Lucknow', state: 'UP', lat: 26.8467, lng: 80.9462, localities: ['Gomti Nagar', 'Aliganj'] },
]

interface ServiceDef {
  code: string
  name: string
  description: string
  basePaise: number
  weight: number
  tanker: boolean
  capacities: ReadonlyArray<{ label: string; litres: number | null }>
  details: readonly string[]
}

// Six catalog rows. The first four codes match supabase/001 (016_standard_service_catalog).
export const SERVICE_CATALOG: readonly ServiceDef[] = [
  {
    code: 'water_tanker', name: 'Water tanker', description: 'Potable and utility water delivery', basePaise: 185_000, weight: 35, tanker: true,
    capacities: [{ label: '500 litres', litres: 500 }, { label: '1000 litres', litres: 1000 }, { label: '2000 litres', litres: 2000 }, { label: '5000 litres', litres: 5000 }],
    details: ['Drinking water', 'Utility water'],
  },
  {
    code: 'sewage_tanker', name: 'Sewage tanker', description: 'Sewage and wastewater transport', basePaise: 210_000, weight: 20, tanker: true,
    capacities: [{ label: '3000 litres', litres: 3000 }, { label: '5000 litres', litres: 5000 }, { label: '10000 litres', litres: 10000 }],
    details: ['Septic tank cleaning', 'Sewage pit emptying', 'Wastewater collection'],
  },
  {
    code: 'tank_cleaning', name: 'Tank cleaning', description: 'Residential and commercial tank cleaning', basePaise: 150_000, weight: 20, tanker: false,
    capacities: [{ label: '1000 litres', litres: 1000 }, { label: '2000 litres', litres: 2000 }, { label: '5000 litres', litres: 5000 }, { label: '10000 litres', litres: 10000 }],
    details: ['Overhead tank cleaning', 'Underground tank cleaning', 'Both overhead and underground tanks'],
  },
  {
    code: 'borewell_service', name: 'Borewell service', description: 'Borewell inspection and service support', basePaise: 450_000, weight: 10, tanker: false,
    capacities: [{ label: 'Single borewell', litres: null }, { label: 'Multiple borewells', litres: null }],
    details: ['Low water output', 'Pump issue', 'Borewell inspection', 'New borewell consultation'],
  },
  {
    code: 'septic_pumping', name: 'Septic pumping', description: 'Septic tank pumping and sludge removal', basePaise: 240_000, weight: 8, tanker: false,
    capacities: [{ label: '2000 litres', litres: 2000 }, { label: '5000 litres', litres: 5000 }],
    details: ['Routine desludging', 'Blocked outlet', 'Overflow emergency'],
  },
  {
    code: 'swimming_pool_drain', name: 'Swimming pool draining', description: 'Pool draining and refill support', basePaise: 320_000, weight: 5, tanker: false,
    capacities: [{ label: '10000 litres', litres: 10000 }, { label: '20000 litres', litres: 20000 }],
    details: ['Full drain', 'Partial drain and refill'],
  },
]

const MEMBERSHIP_PLANS = [
  { name: 'Care', description: 'Priority support and member pricing.', amount: 499, benefits: ['Priority support', 'Member pricing'] },
  { name: 'Care Plus', description: 'Includes one scheduled service credit.', amount: 899, benefits: ['Priority support', 'Member pricing', 'One service credit'] },
  { name: 'Property', description: 'For recurring residential or commercial needs.', amount: 1499, benefits: ['Priority support', 'Member pricing', 'Recurring service planning'] },
] as const

// Ten feature flags. Keys match the ones supabase/001 seeds, plus new bench flags.
const FEATURE_FLAGS: ReadonlyArray<readonly [string, boolean]> = [
  ['maintenance_mode', false],
  ['cash_on_delivery_enabled', true],
  ['guest_booking_enabled', true],
  ['live_tracking_enabled', true],
  ['wallet_payments_enabled', true],
  ['gateway_payments_enabled', false],
  ['referral_program_enabled', false],
  ['vendor_auto_assign_enabled', false],
  ['coupon_codes_enabled', true],
  ['analytics_enabled', true],
]

const SERVICE_CODES = SERVICE_CATALOG.map((service) => service.code)

// Customers with index divisible by this value get a username. Customer 10 is the manifest account.
const USERNAME_EVERY = 10
// Customers with index divisible by this value get wallet rows (20 percent).
const WALLET_EVERY = 5

// ---------- Lifecycle ----------

// The transition chain that leads to a status, in the order supabase/005 allows. Used to write booking_events.
export function lifecyclePath(status: BookingStatus, hasVendor: boolean): BookingStatus[] {
  switch (status) {
    case 'pending_vendor': return ['pending_vendor']
    case 'vendor_assigned': return ['pending_vendor', 'vendor_assigned']
    case 'accepted': return ['pending_vendor', 'accepted']
    case 'en_route': return ['pending_vendor', 'accepted', 'en_route']
    case 'arrived': return ['pending_vendor', 'accepted', 'en_route', 'arrived']
    case 'delivered': return ['pending_vendor', 'accepted', 'en_route', 'arrived', 'delivered']
    case 'cancelled': return hasVendor ? ['pending_vendor', 'accepted', 'cancelled'] : ['pending_vendor', 'cancelled']
  }
}

const OPEN_STATUSES = new Set<BookingStatus>(['pending_vendor', 'vendor_assigned', 'accepted', 'en_route', 'arrived'])
const ANALYTICS_NAME_BY_STATUS: Record<BookingStatus, string> = {
  pending_vendor: 'booking.created',
  vendor_assigned: 'booking.created',
  accepted: 'booking.vendor_accepted',
  en_route: 'booking.vendor_accepted',
  arrived: 'booking.vendor_accepted',
  delivered: 'booking.delivered',
  cancelled: 'booking.cancelled',
}
const NOTIFICATION_TITLE_BY_STATUS: Record<BookingStatus, string> = {
  pending_vendor: 'Still looking for a vendor',
  vendor_assigned: 'Vendor assigned',
  accepted: 'Vendor accepted your booking',
  en_route: 'Vendor is on the way',
  arrived: 'Vendor has arrived',
  delivered: 'Delivery complete',
  cancelled: 'Booking cancelled',
}

// A status for a booking. Future-scheduled bookings stay open. Past bookings are mostly delivered.
// About 70 percent of bookings get a vendor. Unassigned bookings stay pending or get cancelled.
function pickStatus(rng: Rng, hasVendor: boolean, future: boolean): BookingStatus {
  if (!hasVendor) {
    if (future) return weighted<BookingStatus>(rng, [['pending_vendor', 90], ['cancelled', 10]])
    return weighted<BookingStatus>(rng, [['pending_vendor', 50], ['cancelled', 50]])
  }
  if (future) return weighted<BookingStatus>(rng, [['vendor_assigned', 30], ['accepted', 55], ['cancelled', 15]])
  return weighted<BookingStatus>(rng, [
    ['delivered', 84], ['cancelled', 8], ['en_route', 3], ['arrived', 2], ['accepted', 3],
  ])
}

// ---------- Bench quote body ----------

// A body that bookingSchema accepts for POST /api/customer/orders/quote-preview.
// The delivery date is 10 days after today in IST, which is the date the schema compares against.
export function buildBenchQuoteBody(now: Date, serviceCode: string, capacity: string, location: string): string {
  const deliveryDate = istDate(now.getTime() + 10 * DAY_MS)
  return JSON.stringify({
    services: [{ serviceId: serviceCode, capacity, deliveryDate }],
    location,
    paymentMethod: 'cod',
  })
}

// ---------- Generation ----------

function assertScale(scale: ScaleConfig): void {
  for (const [name, value] of Object.entries(scale)) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`scale.${name} must be a positive integer`)
  }
  if (scale.customers < USERNAME_EVERY) throw new Error(`scale.customers must be at least ${USERNAME_EVERY}`)
}

function emptyTables(): SeedTables {
  const tables: Partial<Record<SeedTable, Row[]>> = {}
  for (const table of SEED_TABLE_ORDER) tables[table] = []
  return tables as SeedTables
}

interface Person {
  id: string
  email: string
  phone: string
  username: string | null
}

interface VendorInfo {
  id: string
  ownerId: string
  city: City
  approved: boolean
  usableVehicles: Row[]
  usableDrivers: Row[]
}

export function generateSeedData(options: GenerateOptions): SeedData {
  const { seed, scale, now, password } = options
  assertScale(scale)
  if (password.length === 0) throw new Error('password is required')

  const rng = mulberry32(seed)
  const nowMs = now.getTime()
  const tables = emptyTables()
  const phones = new Set<string>()
  const references = new Set<string>()
  const registrations = new Set<string>()
  const licences = new Set<string>()
  const trackingHashes = new Set<string>()

  const adminId = fixedUuid(STAFF_ID_PREFIX.admin, 1)
  const dispatcherId = fixedUuid(STAFF_ID_PREFIX.dispatcher, 1)

  function addAccount(account: {
    id: string
    email: string
    phone: string
    fullName: string
    role: UserRole
    createdMs: number
    username?: string | null
    signupPlatform?: 'web' | 'mobile'
  }): void {
    const createdAt = iso(account.createdMs)
    const meta: Record<string, string> = { full_name: account.fullName, phone: account.phone }
    if (account.username) meta.username = account.username
    tables.profiles.push({
      id: account.id,
      full_name: account.fullName,
      phone_e164: account.phone,
      role: account.role,
      created_at: createdAt,
      username: account.username ?? null,
      signup_platform: account.signupPlatform ?? 'web',
      theme_mode: 'system',
      email: account.email,
      phone_verified_at: createdAt,
    })
    tables['auth.users'].push({
      id: account.id,
      email: account.email,
      encrypted_password: `bench:${password}`,
      phone: account.phone,
      raw_user_meta_data: meta,
      raw_app_meta_data: { provider: 'email', providers: ['email'], role: account.role },
      aud: 'authenticated',
      role: 'authenticated',
      created_at: createdAt,
      email_confirmed_at: createdAt,
      updated_at: createdAt,
    })
  }

  // Staff accounts.
  addAccount({
    id: adminId, email: `admin-000001@${BENCH_EMAIL_DOMAIN}`, phone: toE164(uniqueValue(phones, () => phoneDigits(rng))),
    fullName: 'Bench Admin', role: 'admin', createdMs: nowMs - 400 * DAY_MS,
  })
  addAccount({
    id: dispatcherId, email: `dispatcher-000001@${BENCH_EMAIL_DOMAIN}`, phone: toE164(uniqueValue(phones, () => phoneDigits(rng))),
    fullName: 'Bench Dispatcher', role: 'dispatcher', createdMs: nowMs - 400 * DAY_MS,
  })

  // Customers. Accounts are created before anything else references them.
  const customers: Person[] = []
  for (let c = 1; c <= scale.customers; c++) {
    const id = fixedUuid(STAFF_ID_PREFIX.customer, c)
    const phone = toE164(uniqueValue(phones, () => phoneDigits(rng)))
    const username = c % USERNAME_EVERY === 0 ? `bench_user_${pad(c, 6)}` : null
    addAccount({
      id,
      email: `customer-${pad(c, 6)}@${BENCH_EMAIL_DOMAIN}`,
      phone,
      fullName: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
      role: 'customer',
      createdMs: nowMs - randInt(rng, 185, 480) * DAY_MS,
      username,
      signupPlatform: chance(rng, 0.6) ? 'mobile' : 'web',
    })
    customers.push({ id, email: `customer-${pad(c, 6)}@${BENCH_EMAIL_DOMAIN}`, phone, username })
  }

  // Vendors: one owner profile each, then vehicles, drivers and their documents.
  const vendors: VendorInfo[] = []
  for (let v = 1; v <= scale.vendors; v++) {
    const ownerId = fixedUuid(STAFF_ID_PREFIX.vendorOwner, v)
    const phone = toE164(uniqueValue(phones, () => phoneDigits(rng)))
    const city = pick(rng, CITIES)
    const createdMs = nowMs - randInt(rng, 190, 600) * DAY_MS
    const verification = v === 1 ? 'approved' : weighted(rng, [['approved', 80], ['pending', 10], ['rejected', 4], ['suspended', 6]])
    addAccount({
      id: ownerId,
      email: `vendor-${pad(v, 6)}@${BENCH_EMAIL_DOMAIN}`,
      phone,
      fullName: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
      role: 'vendor',
      createdMs,
    })
    const vendorId = uuidV4(rng)
    const location = coordinatesNear(rng, city, 0.15)
    tables.vendors.push({
      id: vendorId,
      owner_profile_id: ownerId,
      business_name: `${pick(rng, BUSINESS_PREFIXES)} ${pick(rng, BUSINESS_SUFFIXES)}`,
      phone_e164: phone,
      service_zone: city.name,
      latitude: location.latitude,
      longitude: location.longitude,
      is_online: v === 1 || chance(rng, 0.4),
      verification,
      created_at: iso(createdMs),
    })

    const usableVehicles: Row[] = []
    const vehicleCount = weighted(rng, [[1, 30], [2, 35], [3, 20], [4, 15]])
    for (let j = 0; j < vehicleCount; j++) {
      const vehicleVerification = j === 0 ? 'approved' : weighted(rng, [['approved', 60], ['pending', 20], ['rejected', 10], ['suspended', 10]])
      const isActive = vehicleVerification === 'approved' && (j === 0 || chance(rng, 0.9))
      const vehicle: Row = {
        id: uuidV4(rng),
        vendor_id: vendorId,
        registration_number: uniqueValue(registrations, () =>
          `${city.state}${pad(randInt(rng, 1, 60), 2)}${pick(rng, LETTERS)}${pick(rng, LETTERS)}${pad(randInt(rng, 1, 9999), 4)}`),
        capacity_litres: pick(rng, VEHICLE_CAPACITIES),
        supported_services: pickServiceCodes(rng),
        is_active: isActive,
        metadata: { make: pick(rng, VEHICLE_MAKES), year: randInt(rng, 2015, 2024) },
        verification: vehicleVerification,
      }
      tables.vehicles.push(vehicle)
      if (isActive) usableVehicles.push(vehicle)
      addDocument(rng, {
        ownerType: 'vehicle', ownerId: String(vehicle.id), documentType: 'registration_certificate',
        ownerProfileId: ownerId, ownerVerification: vehicleVerification, createdMs,
      })
    }

    const usableDrivers: Row[] = []
    const driverCount = weighted(rng, [[1, 30], [2, 35], [3, 20], [4, 15]])
    for (let j = 0; j < driverCount; j++) {
      const driverVerification = j === 0 ? 'approved' : weighted(rng, [['approved', 60], ['pending', 20], ['rejected', 10], ['suspended', 10]])
      const isActive = driverVerification === 'approved' && (j === 0 || chance(rng, 0.9))
      const driver: Row = {
        id: uuidV4(rng),
        vendor_id: vendorId,
        name: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
        mobile_e164: toE164(uniqueValue(phones, () => phoneDigits(rng))),
        licence_number: uniqueValue(licences, () =>
          `${city.state}${pad(randInt(rng, 1, 60), 2)}${randInt(rng, 1995, 2015)}${pad(randInt(rng, 1, 9_999_999), 7)}`),
        is_active: isActive,
        verification: driverVerification,
        metadata: { experienceYears: randInt(rng, 1, 20) },
      }
      tables.drivers.push(driver)
      if (isActive) usableDrivers.push(driver)
      addDocument(rng, {
        ownerType: 'driver', ownerId: String(driver.id), documentType: 'driving_licence',
        ownerProfileId: ownerId, ownerVerification: driverVerification, createdMs,
      })
    }

    vendors.push({ id: vendorId, ownerId, city, approved: verification === 'approved', usableVehicles, usableDrivers })
  }

  // Documents: one per vehicle and one per driver. Approved and rejected rows carry a reviewer, as 002 requires.
  function addDocument(docRng: Rng, input: {
    ownerType: 'vehicle' | 'driver'
    ownerId: string
    documentType: string
    ownerProfileId: string
    ownerVerification: string
    createdMs: number
  }): void {
    const createdMs = input.createdMs + DAY_MS
    const verification = input.ownerVerification === 'rejected' ? 'rejected'
      : input.ownerVerification === 'pending' ? (chance(docRng, 0.5) ? 'submitted' : 'pending')
        : 'approved'
    const reviewed = verification === 'approved' || verification === 'rejected'
    tables.documents.push({
      id: uuidV4(docRng),
      owner_type: input.ownerType,
      owner_id: input.ownerId,
      document_type: input.documentType,
      object_key: `${input.ownerProfileId}/${uuidV4(docRng)}.pdf`,
      expires_on: isoDate(nowMs + randInt(docRng, -60, 700) * DAY_MS),
      verification,
      reviewed_by: reviewed ? adminId : null,
      reviewed_at: reviewed ? iso(Math.min(nowMs, createdMs + DAY_MS)) : null,
      created_at: iso(createdMs),
    })
  }

  function pickServiceCodes(codeRng: Rng): string[] {
    const count = randInt(codeRng, 1, 3)
    const codes = new Set<string>()
    while (codes.size < count) codes.add(pick(codeRng, SERVICE_CODES))
    return [...codes]
  }

  // Catalog, coupons, configs and plans.
  for (const service of SERVICE_CATALOG) {
    tables.service_catalog.push({
      id: uuidV4(rng),
      code: service.code,
      name: service.name,
      description: service.description,
      base_price_paise: service.basePaise,
      is_active: true,
      config: {
        capacityOptions: service.capacities.map((capacity) => capacity.label),
        detailOptions: service.details,
        ...(service.tanker ? { tankerCountOptions: ['1', '2', '3', '4', '5'] } : {}),
      },
    })
  }

  // 20 coupons: 16 valid, and 4 whose valid_until has passed while is_active is still true.
  for (let i = 1; i <= 20; i++) {
    const percentage = i % 2 === 1
    const expired = i > 16
    const value = percentage ? pick(rng, [5, 10, 15, 20]) : pick(rng, [50, 100, 150, 200, 300])
    tables.coupons.push({
      id: uuidV4(rng),
      code: `BENCH${pad(i, 3)}`,
      title: percentage ? `${value}% off bench booking` : `INR ${value} off bench booking`,
      discount_type: percentage ? 'percentage' : 'flat',
      discount_value: value,
      valid_until: iso(expired ? nowMs - (i - 12) * DAY_MS : nowMs + (7 + i * 4) * DAY_MS),
      is_active: true,
      created_at: iso(nowMs - 200 * DAY_MS),
    })
  }

  for (const [key, enabled] of FEATURE_FLAGS) {
    tables.configs.push({ key, value: enabled, updated_at: iso(nowMs) })
  }

  for (const plan of MEMBERSHIP_PLANS) {
    tables.membership_plans.push({
      id: uuidV4(rng),
      name: plan.name,
      description: plan.description,
      amount: plan.amount,
      billing_period: 'monthly',
      benefits: [...plan.benefits],
      is_active: true,
      created_at: iso(nowMs - 400 * DAY_MS),
    })
  }

  // Bookings and their children.
  const approvedVendorIndexes = vendors.flatMap((vendor, index) => (vendor.approved ? [index] : []))
  let invoiceSeq = 0
  let paymentSeq = 0
  for (let b = 0; b < scale.bookings; b++) {
    const customer = at(customers, randInt(rng, 0, customers.length - 1))
    const service = weighted(rng, SERVICE_CATALOG.map((item) => [item, item.weight] as const))
    const upcoming = chance(rng, 0.08)

    let createdMs: number
    let scheduledMs: number
    if (upcoming) {
      createdMs = nowMs - randFloat(rng, 0.1 * HOUR_MS, 3 * DAY_MS)
      scheduledMs = istSlotMs(nowMs + randFloat(rng, 0.5 * DAY_MS, 10 * DAY_MS), pick(rng, SLOT_HOURS_IST))
    } else {
      createdMs = nowMs - randFloat(rng, 0.1 * DAY_MS, 180 * DAY_MS)
      scheduledMs = istSlotMs(createdMs + randFloat(rng, 0.1 * DAY_MS, 5 * DAY_MS), pick(rng, SLOT_HOURS_IST))
      if (scheduledMs < createdMs) scheduledMs += DAY_MS
    }
    const future = scheduledMs > nowMs

    const hasVendor = chance(rng, 0.7)
    const status = pickStatus(rng, hasVendor, future)
    const vendorIndex = hasVendor ? pick(rng, approvedVendorIndexes) : -1
    const vendor = vendorIndex >= 0 ? at(vendors, vendorIndex) : null
    const assigned = status === 'accepted' || status === 'en_route' || status === 'arrived' || status === 'delivered'
    const vehicle = vendor && assigned ? pick(rng, vendor.usableVehicles) : null
    const driver = vendor && assigned ? pick(rng, vendor.usableDrivers) : null

    const id = uuidV4(rng)
    const reference = uniqueValue(references, () => `UT-${hexBytes(rng, 5).toUpperCase()}`)
    const city = pick(rng, CITIES)
    const locality = pick(rng, city.localities)
    const coords = coordinatesNear(rng, city, 0.08)
    const capacityIndex = randInt(rng, 0, service.capacities.length - 1)
    const capacity = at(service.capacities, capacityIndex)
    const multiplier = 1 + capacityIndex * 0.5
    const quotedPaise = Math.round(service.basePaise * multiplier * 1.18)
    const paymentMethod = weighted(rng, [['cod', 45], ['wallet', 25], ['gateway', 30]] as const)
    const serviceDetails = service.tanker
      ? [{ serviceId: service.code, capacity: capacity.label, tankerCount: '1', waterType: service.details[0] }]
      : [{ serviceId: service.code, capacity: capacity.label, quantity: '1', details: pick(rng, service.details) }]

    // Lifecycle: events are spread from creation toward the scheduled time, and never after now.
    const path = lifecyclePath(status, hasVendor)
    const spanMs = clamp(scheduledMs - createdMs, 30 * MINUTE_MS, 2 * DAY_MS)
    const eventTimes = path.map((_, k) => Math.min(nowMs, createdMs + Math.round((spanMs * k) / Math.max(1, path.length - 1))))
    const updatedMs = at(eventTimes, eventTimes.length - 1)
    const cancellationReason = status === 'cancelled' ? pick(rng, CANCELLATION_REASONS) : null
    path.forEach((to, k) => {
      const from = k === 0 ? null : at(path, k - 1)
      const actorId = k === 0 || to === 'cancelled' ? customer.id : to === 'vendor_assigned' ? null : (vendor?.ownerId ?? null)
      tables.booking_events.push({
        id: uuidV4(rng),
        booking_id: id,
        actor_id: actorId,
        from_status: from,
        to_status: to,
        note: to === 'cancelled' ? cancellationReason : null,
        created_at: iso(at(eventTimes, k)),
      })
    })

    const otp = status === 'en_route' || status === 'arrived' ? pad(randInt(rng, 0, 999_999), 6) : null
    // Only the hash is stored, as the API does. The token itself is never kept.
    const trackingHash = uniqueValue(trackingHashes, () => sha256Hex(hexBytes(rng, 16)))

    tables.bookings.push({
      id,
      reference,
      customer_id: customer.id,
      customer_phone_e164: customer.phone,
      customer_type: 'registered',
      idempotency_key: chance(rng, 0.5) ? uuidV4(rng) : null,
      vendor_id: vendor?.id ?? null,
      vehicle_id: vehicle ? vehicle.id : null,
      driver_id: driver ? driver.id : null,
      service_code: service.code,
      capacity_litres: capacity.litres,
      scheduled_for: iso(scheduledMs),
      address_text: `${locality}, ${city.name}`,
      latitude: coords.latitude,
      longitude: coords.longitude,
      access_notes: chance(rng, 0.3) ? pick(rng, ACCESS_NOTES) : null,
      cancellation_reason: cancellationReason,
      service_details: serviceDetails,
      quoted_amount_paise: quotedPaise,
      payment_method: paymentMethod,
      status,
      delivery_otp_hash: otp === null ? null : sha256Hex(`${id}:${otp}`),
      delivery_otp_expires_at: otp === null ? null : iso(Math.min(nowMs, at(eventTimes, eventTimes.length - 1) + 15 * MINUTE_MS)),
      delivery_otp_attempts: 0,
      tracking_token_hash: trackingHash,
      tracking_token_expires_at: iso(createdMs + 30 * DAY_MS),
      created_at: iso(createdMs),
      updated_at: iso(updatedMs),
    })

    const ageDays = (nowMs - createdMs) / DAY_MS
    const readAt = (eventMs: number): string | null =>
      chance(rng, ageDays > 7 ? 0.9 : 0.4) ? iso(Math.min(nowMs, eventMs + randFloat(rng, 5 * MINUTE_MS, 12 * HOUR_MS))) : null

    // Three notifications per booking: the customer receipt, the vendor (or dispatcher) alert, and the latest status.
    const payload = { bookingId: id, reference }
    tables.notifications.push({
      id: uuidV4(rng), recipient_id: customer.id, event_type: 'booking_created', title: 'Booking received',
      payload: { ...payload, status: 'pending_vendor' }, read_at: readAt(createdMs), created_at: iso(createdMs),
    })
    tables.notifications.push(vendor
      ? {
        id: uuidV4(rng), recipient_id: vendor.ownerId, event_type: 'vendor_order_created', title: 'New order request',
        payload, read_at: readAt(createdMs), created_at: iso(createdMs),
      }
      : {
        id: uuidV4(rng), recipient_id: dispatcherId, event_type: 'booking_unassigned', title: 'Booking needs a vendor',
        payload, read_at: readAt(createdMs), created_at: iso(createdMs),
      })
    tables.notifications.push({
      id: uuidV4(rng), recipient_id: customer.id, event_type: 'booking_status_updated',
      title: NOTIFICATION_TITLE_BY_STATUS[status], payload: { ...payload, status },
      read_at: readAt(updatedMs), created_at: iso(updatedMs),
    })

    tables.analytics_events.push({
      id: uuidV4(rng),
      event_name: ANALYTICS_NAME_BY_STATUS[status],
      session_id: `bench-${hexBytes(rng, 8)}`,
      properties: { platform: chance(rng, 0.6) ? 'mobile' : 'web', serviceCode: service.code, paymentMethod },
      created_at: iso(createdMs),
    })

    if (status === 'delivered') {
      paymentSeq++
      invoiceSeq++
      const deliveredAt = iso(updatedMs)
      tables.payments.push({
        id: uuidV4(rng),
        booking_id: id,
        provider: paymentMethod === 'cod' ? 'cod' : paymentMethod === 'wallet' ? 'wallet' : 'razorpay',
        provider_order_id: paymentMethod === 'gateway' ? `order_bench_${pad(paymentSeq, 8)}` : null,
        provider_payment_id: paymentMethod === 'cod' ? null : `pay_bench_${pad(paymentSeq, 8)}`,
        amount_paise: quotedPaise,
        currency: 'INR',
        status: 'paid',
        created_at: deliveredAt,
      })
      tables.invoices.push({
        id: uuidV4(rng),
        number: `INV-${pad(invoiceSeq, 8)}`,
        customer_id: customer.id,
        booking_id: id,
        service: service.name,
        location: `${locality}, ${city.name}`,
        amount: round2(quotedPaise / 100),
        status: 'Paid',
        issued_at: deliveredAt,
      })
    }
  }

  // Wallet transactions for 20 percent of customers.
  customers.forEach((customer, index) => {
    if ((index + 1) % WALLET_EVERY !== 0) return
    const count = randInt(rng, 1, 3)
    for (let w = 0; w < count; w++) {
      tables.wallet_transactions.push({
        id: uuidV4(rng),
        customer_id: customer.id,
        type: weighted(rng, [['credit', 60], ['debit', 40]] as const),
        amount: round2(randFloat(rng, 50, 2000)),
        status: weighted(rng, [['completed', 80], ['pending', 10], ['failed', 10]] as const),
        provider_reference: `wlt_bench_${pad(index + 1, 6)}_${pad(w + 1, 2)}`,
        created_at: iso(nowMs - randFloat(rng, 0, 180 * DAY_MS)),
      })
    }
  })

  // The open booking the benchmark uses for booking-detail requests: prefer one with a vendor.
  const isOpen = (row: Row) => OPEN_STATUSES.has(row.status as BookingStatus)
  const openBooking = tables.bookings.find((row) => isOpen(row) && row.vendor_id !== null) ?? tables.bookings.find(isOpen)
  const benchCustomer = customers.find((customer) => customer.username !== null)
  const benchVendor = at(vendors, 0)
  if (!openBooking || !benchCustomer) throw new Error('generated data has no open booking or username customer')
  const firstCity = at(CITIES, 0)

  const manifest: BenchManifest = {
    generatedAt: now.toISOString(),
    seed,
    scale,
    BENCH_CUSTOMER_EMAIL: benchCustomer.email,
    BENCH_CUSTOMER_PASSWORD: password,
    BENCH_CUSTOMER_USERNAME: String(benchCustomer.username),
    BENCH_VENDOR_EMAIL: `vendor-${pad(1, 6)}@${BENCH_EMAIL_DOMAIN}`,
    BENCH_VENDOR_PASSWORD: password,
    BENCH_VENDOR_ID: benchVendor.id,
    BENCH_ADMIN_EMAIL: `admin-000001@${BENCH_EMAIL_DOMAIN}`,
    BENCH_ADMIN_PASSWORD: password,
    BENCH_OPEN_BOOKING_ID: String(openBooking.id),
    BENCH_QUOTE_BODY: buildBenchQuoteBody(now, 'water_tanker', '1000 litres', `${at(firstCity.localities, 0)}, ${firstCity.name}`),
  }

  return { tables, manifest }
}

function coordinatesNear(rng: Rng, city: City, spreadDegrees: number): { latitude: number; longitude: number } {
  return {
    latitude: round6(clamp(city.lat + randFloat(rng, -spreadDegrees, spreadDegrees), 8.5, 34.5)),
    longitude: round6(clamp(city.lng + randFloat(rng, -spreadDegrees, spreadDegrees), 68.5, 96.5)),
  }
}
