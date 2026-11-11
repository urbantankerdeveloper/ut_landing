export type RazorpayPaymentEntity = {
  id?: string
  created_at?: number | null
  order_id?: string | null
  status?: string | null
  method?: string | null
  amount?: number | null
  currency?: string | null
  international?: boolean | null
  fee?: number | null
  tax?: number | null
  email?: string | null
  contact?: string | null
  bank?: string | null
  wallet?: string | null
  vpa?: string | null
  card?: {
    last4?: string | null
    network?: string | null
    type?: string | null
    issuer?: string | null
  } | null
  error_code?: string | null
  error_description?: string | null
  error_source?: string | null
  error_step?: string | null
  error_reason?: string | null
}

export type PaymentDetailColumns = {
  method: string | null
  bank: string | null
  wallet: string | null
  vpa: string | null
  card_network: string | null
  card_last4: string | null
  card_type: string | null
  card_issuer: string | null
  international: boolean | null
  fee_paise: number | null
  tax_paise: number | null
  payer_email: string | null
  payer_contact: string | null
  error_code: string | null
  error_description: string | null
  error_source: string | null
  error_step: string | null
  error_reason: string | null
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)
const minorUnits = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null)

// Only masked card data and non-secret identifiers are kept. Card numbers, CVVs and card_id never reach this function's output.
export function extractPaymentDetails(entity: RazorpayPaymentEntity | null | undefined): PaymentDetailColumns {
  const card = entity?.card ?? null
  return {
    method: text(entity?.method),
    bank: text(entity?.bank),
    wallet: text(entity?.wallet),
    vpa: text(entity?.vpa),
    card_network: text(card?.network),
    card_last4: text(card?.last4),
    card_type: text(card?.type),
    card_issuer: text(card?.issuer),
    international: typeof entity?.international === 'boolean' ? entity.international : null,
    fee_paise: minorUnits(entity?.fee),
    tax_paise: minorUnits(entity?.tax),
    payer_email: text(entity?.email),
    payer_contact: text(entity?.contact),
    error_code: text(entity?.error_code),
    error_description: text(entity?.error_description),
    error_source: text(entity?.error_source),
    error_step: text(entity?.error_step),
    error_reason: text(entity?.error_reason),
  }
}

// Razorpay timestamps are epoch seconds.
export function epochSecondsToIso(seconds: unknown): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000).toISOString()
}
