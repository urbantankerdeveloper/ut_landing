import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  row: { subject: 'Booking {{reference}}', body: 'Track it: {{trackingUrl}}', is_active: true },
}))

vi.mock('../supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: mocks.row, error: null })),
        })),
      })),
    })),
  },
}))
vi.mock('./providers.js', () => ({ sendEmail: mocks.sendEmail }))

import {
  emailTemplatePlaceholderError,
  invalidateEmailTemplateCache,
  renderEmailTemplate,
  sendTemplateEmail,
} from './emailTemplates.js'

describe('email templates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateEmailTemplateCache()
    mocks.row = { subject: 'Booking {{reference}}', body: 'Track it: {{trackingUrl}}', is_active: true }
    mocks.sendEmail.mockResolvedValue({ queued: true })
  })

  it('renders independent HTML content and escapes customer-provided values', () => {
    const result = renderEmailTemplate(
      'Booking {{reference}}',
      'Hello {{reference}}\n\nTrack it: {{trackingUrl}}',
      { reference: '<UT-1>', trackingUrl: 'https://example.test/?a=1&b=2' },
    )

    expect(result.subject).toBe('Booking <UT-1>')
    expect(result.html).toContain('Hello &lt;UT-1&gt;')
    expect(result.html).toContain('https://example.test/?a=1&amp;b=2')
    expect(result.html).not.toContain('<UT-1>')
  })

  it('requires the placeholders needed by each action and rejects unknown ones', () => {
    expect(emailTemplatePlaceholderError('guest_booking_confirmation', 'Booking', 'Hi {{reference}}')).toContain('{{trackingUrl}}')
    expect(emailTemplatePlaceholderError('booking_en_route', 'Update {{reference}}', '{{detail}} {{trackingUrl}} {{unexpected}}')).toContain('{{unexpected}}')
    expect(emailTemplatePlaceholderError('user_registration_otp', 'Registration', 'Use {{otp}} to verify')).toBeNull()
  })

  it('loads the email-specific template from storage before sending', async () => {
    await expect(sendTemplateEmail('guest_booking_confirmation', 'customer@example.com', {
      reference: 'UT-1',
      trackingUrl: 'https://example.test/track',
    })).resolves.toEqual({ queued: true })

    expect(mocks.sendEmail).toHaveBeenCalledWith(
      'customer@example.com',
      'Booking UT-1',
      expect.stringContaining('Track it: https://example.test/track'),
    )
  })
})
