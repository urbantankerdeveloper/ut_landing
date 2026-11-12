import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { realtimeContent } from '../src/content/realtime'
import { acceptWithFleet, createCodBooking, readRealtimeEnv, updateVendorOrder, type Credentials, type RealtimeEnv } from './realtime-api'

type SocketLogEntry = { at: string; direction: 'in' | 'out' | 'meta'; event?: string; detail: string }
type SocketRecorder = { entries: SocketLogEntry[]; connected: () => boolean }

const noticeTimeout = 15_000

// Records raw Socket.IO frames from the page's WebSocket, so diagnostics do not depend on what the UI shows.
function recordSocket(page: Page): SocketRecorder {
  const entries: SocketLogEntry[] = []
  let connected = false
  const add = (entry: Omit<SocketLogEntry, 'at'>) => entries.push({ at: new Date().toISOString(), ...entry })

  page.on('websocket', (socket) => {
    add({ direction: 'meta', detail: `websocket opened: ${socket.url()}` })
    const handle = (direction: 'in' | 'out') => (frame: { payload: string | Buffer }) => {
      const payload = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8')
      if (payload.startsWith('40')) {
        connected = true
        add({ direction: 'meta', detail: 'socket.io namespace connected' })
      } else if (payload.startsWith('42')) {
        try {
          const [event, data] = JSON.parse(payload.slice(2)) as [string, unknown]
          add({ direction, event, detail: JSON.stringify(data).slice(0, 300) })
        } catch {
          add({ direction, detail: `unparsed event packet: ${payload.slice(0, 120)}` })
        }
      }
    }
    socket.on('framereceived', handle('in'))
    socket.on('framesent', handle('out'))
    socket.on('close', () => add({ direction: 'meta', detail: 'websocket closed' }))
  })

  return { entries, connected: () => connected }
}

async function logIn(page: Page, credentials: Credentials): Promise<string> {
  await page.goto('/login')
  await page.locator('#login-username').fill(credentials.login)
  await page.locator('#login-password').fill(credentials.password)
  const loginResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST')
  await page.locator('form.auth-form button[type="submit"]').click()
  const body = (await (await loginResponse).json()) as { accessToken: string }
  return body.accessToken
}

function toast(page: Page, message: string) {
  return page.locator('.toast-message', { hasText: message })
}

async function attachDiagnostics(testInfo: TestInfo, pages: Array<{ name: string; page: Page; socket: SocketRecorder }>) {
  for (const { name, page, socket } of pages) {
    const body = JSON.stringify({ socketConnected: socket.connected(), entries: socket.entries }, null, 2)
    await testInfo.attach(`${name}-socket-log.json`, { body, contentType: 'application/json' })
    const screenshot = await page.screenshot({ fullPage: true }).catch(() => undefined)
    if (screenshot) await testInfo.attach(`${name}-screenshot.png`, { body: screenshot, contentType: 'image/png' })
  }
}

test('customer and vendor windows see live booking notices end to end', async ({ browser }, testInfo) => {
  const env: RealtimeEnv = readRealtimeEnv()
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:5173'
  const customerContext = await browser.newContext({ baseURL })
  const vendorContext = await browser.newContext({ baseURL })
  const customerPage = await customerContext.newPage()
  const vendorPage = await vendorContext.newPage()
  const customerSocket = recordSocket(customerPage)
  const vendorSocket = recordSocket(vendorPage)

  try {
    const customerToken = await logIn(customerPage, env.customer)
    const vendorToken = await logIn(vendorPage, env.vendor)
    await expect.poll(() => customerSocket.connected(), { timeout: noticeTimeout, message: 'customer socket never connected' }).toBe(true)
    await expect.poll(() => vendorSocket.connected(), { timeout: noticeTimeout, message: 'vendor socket never connected' }).toBe(true)

    const booking = await createCodBooking(env, customerToken)
    await expect(toast(vendorPage, realtimeContent.vendor.newOrder(booking.reference))).toBeVisible({ timeout: noticeTimeout })
    await expect(vendorPage.locator('.nav-unread-badge')).toBeVisible({ timeout: noticeTimeout })

    await acceptWithFleet(env, vendorToken, booking.id)
    await expect(toast(customerPage, realtimeContent.customer.accepted)).toBeVisible({ timeout: noticeTimeout })

    await updateVendorOrder(env, vendorToken, booking.id, { action: 'status', status: 'En route' })
    await updateVendorOrder(env, vendorToken, booking.id, { action: 'status', status: 'Delivered' })
    await expect(toast(customerPage, realtimeContent.customer.delivered)).toBeVisible({ timeout: noticeTimeout })
  } catch (error) {
    await attachDiagnostics(testInfo, [
      { name: 'customer', page: customerPage, socket: customerSocket },
      { name: 'vendor', page: vendorPage, socket: vendorSocket },
    ])
    throw error
  } finally {
    await customerContext.close()
    await vendorContext.close()
  }
})
