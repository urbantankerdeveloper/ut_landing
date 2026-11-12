import { randomUUID } from 'node:crypto'

export type Credentials = { login: string; password: string }

export type RealtimeEnv = {
  apiUrl: string
  serviceCode: string
  customer: Credentials
  vendor: Credentials
}

const requiredVariables = [
  'REALTIME_CUSTOMER_LOGIN',
  'REALTIME_CUSTOMER_PASSWORD',
  'REALTIME_VENDOR_LOGIN',
  'REALTIME_VENDOR_PASSWORD',
] as const

// Test accounts come from the environment so no credentials live in source. See docs/e2e_seed_data.md.
export function readRealtimeEnv(): RealtimeEnv {
  const missing = requiredVariables.filter((name) => !process.env[name])
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}. See docs/e2e_seed_data.md.`)
  return {
    apiUrl: process.env.REALTIME_API_URL ?? 'http://localhost:8080',
    serviceCode: process.env.REALTIME_SERVICE_CODE ?? 'water_tanker',
    customer: { login: process.env.REALTIME_CUSTOMER_LOGIN!, password: process.env.REALTIME_CUSTOMER_PASSWORD! },
    vendor: { login: process.env.REALTIME_VENDOR_LOGIN!, password: process.env.REALTIME_VENDOR_PASSWORD! },
  }
}

async function postJson<T>(url: string, token: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${method} ${url} failed with ${response.status}: ${await response.text()}`)
  return response.json() as Promise<T>
}

// Cash-on-delivery keeps the booking free of payment-gateway steps. The location sits inside the seeded vendor's service zone.
export async function createCodBooking(env: RealtimeEnv, customerToken: string): Promise<{ id: string; reference: string }> {
  const deliveryDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return postJson(`${env.apiUrl}/api/customer/orders`, customerToken, 'POST', {
    idempotencyKey: randomUUID(),
    services: [{ serviceId: env.serviceCode, capacity: '12', waterType: 'Construction water', tankerCount: '1' }],
    location: 'T Nagar, Chennai',
    latitude: 13.0418,
    longitude: 80.2341,
    deliveryDate,
    preferredTime: '07:00',
    paymentMethod: 'cod',
  })
}

export async function updateVendorOrder(env: RealtimeEnv, vendorToken: string, bookingId: string, body: Record<string, string>) {
  return postJson(`${env.apiUrl}/api/vendor/orders/${bookingId}/transition`, vendorToken, 'PATCH', body)
}

// Accept requires an approved fleet vehicle and driver on the vendor account.
export async function acceptWithFleet(env: RealtimeEnv, vendorToken: string, bookingId: string) {
  const vehicles = await getJson<Array<{ id: string; is_active: boolean; verification: string }>>(`${env.apiUrl}/api/vendor/vehicles`, vendorToken)
  const drivers = await getJson<Array<{ id: string; is_active: boolean; verification: string }>>(`${env.apiUrl}/api/vendor/drivers`, vendorToken)
  const vehicle = vehicles.find((item) => item.is_active && item.verification === 'approved')
  const driver = drivers.find((item) => item.is_active && item.verification === 'approved')
  if (!vehicle || !driver) throw new Error('vendor needs an approved active vehicle and driver (see docs/e2e_seed_data.md)')
  return updateVendorOrder(env, vendorToken, bookingId, { action: 'accept', vehicleId: vehicle.id, driverId: driver.id })
}

async function getJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`)
  return response.json() as Promise<T>
}
