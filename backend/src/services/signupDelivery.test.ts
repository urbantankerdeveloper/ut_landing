import { describe, expect, it, vi } from 'vitest'

vi.mock('../config.js', () => ({
  config: {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: 465,
    SMTP_SECURE: true,
    SMTP_USER: 'mailer@example.com',
    SMTP_PASSWORD: 'secret',
    MAIL_FROM: 'mailer@example.com',
  },
}))

import { sendSignupConfirmation } from './signupDelivery.js'

describe('sendSignupConfirmation', () => {
  it('reports sent and keeps the account when the email is queued', async () => {
    const rollback = vi.fn(async () => true)

    const outcome = await sendSignupConfirmation({
      send: async () => ({ queued: true }),
      rollback,
    })

    expect(outcome).toEqual({ sent: true })
    expect(rollback).not.toHaveBeenCalled()
  })

  it('removes the unconfirmed account when the provider refuses the message', async () => {
    const rollback = vi.fn(async () => true)

    const outcome = await sendSignupConfirmation({
      send: async () => ({ queued: false, reason: 'SMTP_USER is not configured' }),
      rollback,
    })

    expect(outcome).toEqual({ sent: false, reason: 'SMTP_USER is not configured', cleanedUp: true })
    expect(rollback).toHaveBeenCalledTimes(1)
  })

  it('records only the SMTP error code when sending throws', async () => {
    const rollback = vi.fn(async () => true)
    const smtpError = Object.assign(new Error('535 Invalid credentials for alice@example.com'), { code: 'EAUTH' })

    const outcome = await sendSignupConfirmation({
      send: async () => {
        throw smtpError
      },
      rollback,
    })

    expect(outcome).toEqual({ sent: false, reason: 'EAUTH', cleanedUp: true })
    expect(JSON.stringify(outcome)).not.toContain('alice@example.com')
    expect(rollback).toHaveBeenCalledTimes(1)
  })

  it('still reports the failure when the rollback itself fails', async () => {
    const outcome = await sendSignupConfirmation({
      send: async () => ({ queued: false, reason: 'provider down' }),
      rollback: async () => {
        throw new Error('database unavailable')
      },
    })

    expect(outcome).toEqual({ sent: false, reason: 'provider down', cleanedUp: false })
  })

  it('uses a generic reason when the provider gives none', async () => {
    const outcome = await sendSignupConfirmation({
      send: async () => ({ queued: false }),
      rollback: async () => true,
    })

    expect(outcome).toEqual({
      sent: false,
      reason: 'The mail provider did not accept the message.',
      cleanedUp: true,
    })
  })
})
