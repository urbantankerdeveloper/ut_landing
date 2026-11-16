import { config } from '../config.js'
import { logger } from '../lib/logger.js'
import { supabase } from '../supabase.js'
import type { InvoiceLineSnapshot } from './pricing.js'

type InvoiceBooking = {
  id: string
  reference: string
  customer_id: string | null
  status: string
  payment_method: string
  quoted_amount_paise: number | null
  service_details: unknown
  address_text: string | null
  order_group_id: string | null
  updated_at: string | null
}

function isInvoiceLine(value: unknown): value is InvoiceLineSnapshot {
  if (!value || typeof value !== 'object') return false
  const line = value as Record<string, unknown>
  return typeof line.serviceCode === 'string'
    && typeof line.description === 'string'
    && Number.isInteger(line.quantity) && Number(line.quantity) > 0
    && Number.isSafeInteger(line.subtotalPaise) && Number(line.subtotalPaise) >= 0
    && Number.isSafeInteger(line.taxPaise) && Number(line.taxPaise) >= 0
    && typeof line.taxRate === 'number' && Number.isFinite(line.taxRate) && line.taxRate >= 0
    && Number.isSafeInteger(line.discountPaise) && Number(line.discountPaise) >= 0
    && Number.isSafeInteger(line.totalPaise) && Number(line.totalPaise) >= 0
    && Number(line.totalPaise) === Number(line.subtotalPaise) + Number(line.taxPaise) - Number(line.discountPaise)
}

function invoiceLines(details: unknown): InvoiceLineSnapshot[] {
  if (!Array.isArray(details)) return []
  const lines = details.map((item) => item && typeof item === 'object'
    ? (item as Record<string, unknown>).invoice_line
    : undefined)
  return lines.length > 0 && lines.every(isInvoiceLine) ? lines : []
}

async function paymentBooking(booking: InvoiceBooking) {
  if (!booking.order_group_id) {
    return { id: booking.id, totalPaise: Number(booking.quoted_amount_paise) }
  }
  const { data, error } = await supabase.from('bookings')
    .select('id,reference,quoted_amount_paise')
    .eq('order_group_id', booking.order_group_id)
    .order('reference', { ascending: true })
    .limit(100)
  if (error) throw error
  const rows = data ?? []
  return {
    id: rows[0]?.id ?? booking.id,
    totalPaise: rows.reduce((total, row) => total + Number(row.quoted_amount_paise ?? 0), 0),
  }
}

export async function createInvoiceIfEligible(bookingId: string): Promise<boolean> {
  if (!config.featureFlags.invoice_generation_enabled) return false

  const { data: booking, error: bookingError } = await supabase.from('bookings')
    .select('id,reference,customer_id,status,payment_method,quoted_amount_paise,service_details,address_text,order_group_id,updated_at')
    .eq('id', bookingId)
    .maybeSingle()
  if (bookingError) throw bookingError
  if (!booking || booking.status !== 'delivered' || !booking.customer_id) return false

  const lines = invoiceLines(booking.service_details)
  if (!lines.length) {
    logger.warn('invoice.snapshot_missing', { bookingId: booking.id })
    return false
  }
  const totalPaise = lines.reduce((total, line) => total + line.totalPaise, 0)
  if (!Number.isSafeInteger(totalPaise) || totalPaise !== Number(booking.quoted_amount_paise)) {
    logger.error('invoice.snapshot_total_mismatch', { bookingId: booking.id, snapshotPaise: totalPaise, bookingPaise: booking.quoted_amount_paise })
    return false
  }

  let paymentStatus: string
  let paidAt: string
  if (booking.payment_method === 'cod') {
    const paidAtValue = booking.updated_at ?? new Date().toISOString()
    const payment = await paymentBooking(booking)
    const { error } = await supabase.from('payments')
      .update({ status: 'paid', captured_at: paidAtValue, updated_at: paidAtValue })
      .eq('booking_id', payment.id)
      .eq('provider', 'cash_on_delivery')
      .in('status', ['pending', 'paid'])
    if (error) throw error
    paymentStatus = 'paid'
    paidAt = paidAtValue
  } else if (booking.payment_method === 'wallet') {
    paymentStatus = 'paid'
    paidAt = booking.updated_at ?? new Date().toISOString()
  } else if (booking.payment_method === 'gateway') {
    const orderPayment = await paymentBooking(booking)
    const { data: payment, error } = await supabase.from('payments')
      .select('status,amount_paise,refunded_paise,captured_at')
      .eq('booking_id', orderPayment.id)
      .maybeSingle()
    if (error) throw error
    if (!payment || !['paid', 'refunded'].includes(payment.status) || Number(payment.amount_paise) !== orderPayment.totalPaise) return false
    const refundedPaise = Number(payment.refunded_paise ?? 0)
    paymentStatus = payment.status === 'refunded' || refundedPaise >= orderPayment.totalPaise
      ? 'refunded'
      : refundedPaise > 0 ? 'partially_refunded' : 'paid'
    paidAt = payment.captured_at ?? booking.updated_at ?? new Date().toISOString()
  } else {
    return false
  }

  const subtotalPaise = lines.reduce((total, line) => total + line.subtotalPaise, 0)
  const taxPaise = lines.reduce((total, line) => total + line.taxPaise, 0)
  const discountPaise = lines.reduce((total, line) => total + line.discountPaise, 0)
  const { error } = await supabase.from('invoices').upsert({
    number: `INV-${booking.reference}`,
    customer_id: booking.customer_id,
    booking_id: booking.id,
    service: lines.map((line) => line.description).join(', '),
    location: booking.address_text ?? '',
    amount: totalPaise / 100,
    status: paymentStatus,
    line_items: lines,
    subtotal_paise: subtotalPaise,
    tax_paise: taxPaise,
    tax_rate: lines.reduce((rate, line) => Math.max(rate, line.taxRate), 0),
    discount_paise: discountPaise,
    total_paise: totalPaise,
    payment_method: booking.payment_method,
    payment_status: paymentStatus,
    paid_at: paidAt,
  }, { onConflict: 'booking_id' })
  if (error) throw error
  return true
}

export async function generateMissingCustomerInvoices(customerId: string) {
  if (!config.featureFlags.invoice_generation_enabled) return
  const [bookings, invoices] = await Promise.all([
    supabase.from('bookings')
      .select('id')
      .eq('customer_id', customerId)
      .eq('status', 'delivered')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('invoices')
      .select('booking_id')
      .eq('customer_id', customerId)
      .limit(1000),
  ])
  if (bookings.error) throw bookings.error
  if (invoices.error) throw invoices.error
  const existing = new Set((invoices.data ?? []).map((invoice) => invoice.booking_id))
  for (const booking of bookings.data ?? []) {
    if (!existing.has(booking.id)) await createInvoiceIfEligible(booking.id)
  }
}

export async function syncInvoicePaymentStatus(bookingId: string, status: string, refundedPaise: number) {
  if (!config.featureFlags.invoice_generation_enabled) return
  const paymentId = (await supabase.from('bookings').select('id,order_group_id').eq('id', bookingId).maybeSingle())
  if (paymentId.error) throw paymentId.error
  if (!paymentId.data) return
  let bookingIds = [paymentId.data.id]
  if (paymentId.data.order_group_id) {
    const { data, error } = await supabase.from('bookings').select('id').eq('order_group_id', paymentId.data.order_group_id)
    if (error) throw error
    bookingIds = (data ?? []).map((booking) => booking.id)
  }
  const paymentStatus = status === 'refunded' ? 'refunded' : refundedPaise > 0 ? 'partially_refunded' : status
  const { error } = await supabase.from('invoices')
    .update({ status: paymentStatus, payment_status: paymentStatus })
    .in('booking_id', bookingIds)
  if (error) throw error
}
