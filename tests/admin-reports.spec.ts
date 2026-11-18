import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import ExcelJS from 'exceljs'

const flags = {
  duplicate_phone_check_enabled: false,
  mpin_cooldown_enabled: false,
  multi_service_tasks_enabled: false,
  order_tracking_board_enabled: false,
  vendor_earnings_realtime_enabled: false,
  online_payment_enabled: false,
  manual_assignment_mode_enabled: false,
  admin_availability_toggle_enabled: false,
  admin_dashboard_v2_enabled: false,
  area_availability_enabled: false,
  partner_application_otp_enabled: false,
  address_geocoding_enabled: false,
  invoice_generation_enabled: false,
  wallet_enabled: false,
}

test('admin vendor reports export the filtered result as CSV, Excel, and PDF', async ({ page }) => {
  let reportRequest: Record<string, unknown> | undefined
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/auth/login')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accessToken: 'admin-test-token',
          user: { username: 'admin@test.example', name: 'Test Admin', role: 'admin' },
        }),
      })
    }
    if (url.pathname.endsWith('/config/flags')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(flags) })
    }
    if (url.pathname.endsWith('/admin/reports')) {
      reportRequest = route.request().postDataJSON() as Record<string, unknown>
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'vendors',
          generatedAt: '2026-11-18T00:00:00.000Z',
          total: 12500,
          rows: [{
            vendor_id: 'vendor-1',
            business_name: 'Chennai Water Services',
            booking_count: 2,
            completed_count: 1,
            quoted_amount_paise: 12500,
            created_at: '2026-11-17T10:00:00.000Z',
          }],
        }),
      })
    }
    if (url.pathname.endsWith('/admin/orders')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [] }) })
    }
    if (url.pathname.startsWith('/api/') || url.port === '8080') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return route.continue()
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByLabel('Username or email').fill('admin@test.example')
  await page.locator('#login-password').fill('admin-password')
  await page.getByRole('button', { name: /^Log in$/ }).last().click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.getByRole('banner').getByRole('button', { name: 'My account', exact: true }).click()
  await expect(page.getByText('Test Admin')).toBeVisible()

  const navigation = page.locator('.workspace-nav-new')
  await navigation.getByRole('button', { name: 'Reports & setup' }).click()
  await navigation.getByRole('button', { name: 'Reports', exact: true }).click()
  await page.getByLabel('Report type').selectOption('vendors')
  const to = page.getByRole('textbox', { name: 'To' })
  await page.getByLabel('From').fill(await to.inputValue())
  await page.getByRole('button', { name: 'Generate report' }).click()
  expect(reportRequest).toMatchObject({ type: 'vendors' })
  await expect(page.getByRole('table').getByText('Chennai Water Services')).toBeVisible()
  expect(reportRequest?.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(reportRequest?.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ])
  expect(csvDownload.suggestedFilename()).toMatch(/^urban-tanker-vendors-report-\d{4}-\d{2}-\d{2}\.csv$/)
  const csvPath = await csvDownload.path()
  if (!csvPath) throw new Error('CSV download did not produce a file')
  const csv = await readFile(csvPath, 'utf8')
  expect(csv).toContain('Chennai Water Services')
  expect(csv).toContain('2,1,125.00')

  const [excelDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export Excel' }).click(),
  ])
  expect(excelDownload.suggestedFilename()).toBe(`urban-tanker-vendors-report-${await to.inputValue()}.xlsx`)
  const excelPath = await excelDownload.path()
  if (!excelPath) throw new Error('Excel download did not produce a file')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(excelPath)
  const worksheet = workbook.getWorksheet('Report')
  expect(worksheet?.getCell('A1').value).toBe('Vendor performance report')
  expect(worksheet?.getRow(5).values).toEqual([
    undefined,
    'Chennai Water Services',
    2,
    1,
    125,
  ])

  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export PDF' }).click(),
  ])
  expect(pdfDownload.suggestedFilename()).toBe('urban-tanker-vendor-performance-report.pdf')
  const pdfPath = await pdfDownload.path()
  if (!pdfPath) throw new Error('PDF download did not produce a file')
  expect((await readFile(pdfPath)).subarray(0, 4).toString()).toBe('%PDF')
})
