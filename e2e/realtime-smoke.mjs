// Browser-free check of the realtime contract: HTTP for actions, socket.io-client for events.
// Usage: REALTIME_CUSTOMER_LOGIN=... node e2e/realtime-smoke.mjs   (see docs/e2e_seed_data.md)
import { randomUUID } from 'node:crypto'
import { io } from 'socket.io-client'

const apiUrl = process.env.REALTIME_API_URL ?? 'http://localhost:8080'
const serviceCode = process.env.REALTIME_SERVICE_CODE ?? 'water_tanker'
const timeoutMs = Number(process.env.REALTIME_TIMEOUT_MS ?? 15000)
const required = ['REALTIME_CUSTOMER_LOGIN', 'REALTIME_CUSTOMER_PASSWORD', 'REALTIME_VENDOR_LOGIN', 'REALTIME_VENDOR_PASSWORD']
const missing = required.filter((name) => !process.env[name])
if (missing.length) {
  console.error(`Missing ${missing.join(', ')}. See docs/e2e_seed_data.md.`)
  process.exit(2)
}

async function request(method, path, token, body) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

async function login(login, password) {
  const body = await request('POST', '/api/auth/login', undefined, { username: login, password })
  return body.accessToken
}

// Records every event with its arrival time so a failure shows exactly what each side received.
function connect(name, token) {
  const received = []
  const socket = io(apiUrl, { auth: { token }, transports: ['websocket'], reconnection: false })
  socket.onAny((event, data) => received.push({ at: new Date().toISOString(), event, data }))
  const connected = new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', (error) => reject(new Error(`${name} socket connect_error: ${error.message}`)))
  })
  return { name, socket, received, connected }
}

function waitForEvent(client, event, bookingId) {
  const matches = (entry) => entry.event === event && (entry.data?.bookingId === undefined || entry.data.bookingId === bookingId)
  return new Promise((resolve, reject) => {
    const found = client.received.find(matches)
    if (found) return resolve(found)
    const timer = setTimeout(() => {
      client.socket.offAny(listener)
      reject(new Error(`${client.name} did not receive ${event} for ${bookingId} within ${timeoutMs}ms`))
    }, timeoutMs)
    const listener = (name, data) => {
      if (name === event && (data?.bookingId === undefined || data.bookingId === bookingId)) {
        clearTimeout(timer)
        client.socket.offAny(listener)
        resolve({ at: new Date().toISOString(), event: name, data })
      }
    }
    client.socket.onAny(listener)
  })
}

function step(label) {
  process.stdout.write(`- ${label} ... `)
  return {
    pass: (detail = '') => console.log(`PASS${detail ? ` (${detail})` : ''}`),
  }
}

async function main() {
  const customerToken = await login(process.env.REALTIME_CUSTOMER_LOGIN, process.env.REALTIME_CUSTOMER_PASSWORD)
  const vendorToken = await login(process.env.REALTIME_VENDOR_LOGIN, process.env.REALTIME_VENDOR_PASSWORD)
  const customer = connect('customer', customerToken)
  const vendor = connect('vendor', vendorToken)
  clients = [customer, vendor]
  await Promise.all([customer.connected, vendor.connected])

  const deliveryDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  let s = step('customer creates a COD booking')
  const booking = await request('POST', '/api/customer/orders', customerToken, {
    idempotencyKey: randomUUID(),
    services: [{ serviceId: serviceCode, capacity: '12', waterType: 'Construction water', tankerCount: '1' }],
    location: 'T Nagar, Chennai',
    latitude: 13.0418,
    longitude: 80.2341,
    deliveryDate,
    preferredTime: '07:00',
    paymentMethod: 'cod',
  })
  s.pass(booking.reference ?? booking.id)

  s = step('vendor receives vendor.order.created')
  await waitForEvent(vendor, 'vendor.order.created', booking.id)
  s.pass()

  s = step('vendor accepts with an approved vehicle and driver')
  const [vehicle] = (await request('GET', '/api/vendor/vehicles', vendorToken)).filter((item) => item.is_active && item.verification === 'approved')
  const [driver] = (await request('GET', '/api/vendor/drivers', vendorToken)).filter((item) => item.is_active && item.verification === 'approved')
  if (!vehicle || !driver) throw new Error('vendor needs an approved active vehicle and driver (see docs/e2e_seed_data.md)')
  await request('PATCH', `/api/vendor/orders/${booking.id}/transition`, vendorToken, { action: 'accept', vehicleId: vehicle.id, driverId: driver.id })
  s.pass()

  s = step('customer receives booking.vendor_accepted')
  await waitForEvent(customer, 'booking.vendor_accepted', booking.id)
  s.pass()

  s = step('vendor sets En route, Arrived, then Delivered')
  await request('PATCH', `/api/vendor/orders/${booking.id}/transition`, vendorToken, { action: 'status', status: 'En route' })
  await request('PATCH', `/api/vendor/orders/${booking.id}/transition`, vendorToken, { action: 'status', status: 'Arrived' })
  await request('PATCH', `/api/vendor/orders/${booking.id}/transition`, vendorToken, { action: 'status', status: 'Delivered' })
  s.pass()

  s = step('customer receives booking.delivered')
  await waitForEvent(customer, 'booking.delivered', booking.id)
  s.pass()

  console.log('\nRealtime smoke passed.')
}

// Sockets are closed in finally so a failed step cannot keep the process alive.
let clients = []
main()
  .catch((error) => {
    console.error(`FAILED: ${error.message}`)
    process.exitCode = 1
  })
  .finally(() => {
    for (const client of clients) client.socket.disconnect()
  })
