import { beforeEach, describe, expect, it, vi } from 'vitest'

const mail = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({})) }))
const mailConfig = vi.hoisted(() => ({
  EMAIL_PROVIDER: 'smtp',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: 465,
  SMTP_SECURE: true,
  SMTP_USER: 'mailer@example.com' as string | undefined,
  SMTP_PASSWORD: 'secret' as string | undefined,
  RESEND_API_KEY: undefined as string | undefined,
  MAIL_FROM: 'mailer@example.com' as string | undefined,
}))

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ sendMail: mail.sendMail })) } }))

vi.mock('../config.js', () => ({ config: mailConfig }))

import { isEmailConfigured, notifyUser, sendEmail } from './providers.js'

describe('notifyUser', () => {
  beforeEach(() => {
    mail.sendMail.mockClear()
    Object.assign(mailConfig, { EMAIL_PROVIDER: 'smtp', SMTP_USER: 'mailer@example.com', SMTP_PASSWORD: 'secret', RESEND_API_KEY: undefined, MAIL_FROM: 'mailer@example.com' })
  })

  it('escapes the message before it is placed in the email HTML', async () => {
    await notifyUser({ email: 'customer@example.com' }, 'Your fleet', 'Ref <b>UT1</b> & "more"')
    expect(mail.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      html: '<p>Ref &lt;b&gt;UT1&lt;/b&gt; &amp; &quot;more&quot;</p>',
    }))
  })

  it('does not send email when SMTP is not configured', async () => {
    Object.assign(mailConfig, { SMTP_USER: undefined, SMTP_PASSWORD: undefined, MAIL_FROM: undefined })

    const [emailResult] = await notifyUser({ email: 'customer@example.com' }, 'Your fleet', 'Booking accepted.')

    expect(emailResult).toMatchObject({ queued: false })
    expect(mail.sendMail).not.toHaveBeenCalled()
  })

  it('sends email through Resend when an API key is configured', async () => {
    Object.assign(mailConfig, {
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'resend-test-key',
      SMTP_USER: undefined,
      SMTP_PASSWORD: undefined,
      MAIL_FROM: 'verify@example.com',
    })
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(isEmailConfigured()).toBe(true)
    await expect(sendEmail('customer@example.com', 'Verification', '<p>Code</p>')).resolves.toEqual({ queued: true })
    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer resend-test-key' }),
      body: JSON.stringify({
        from: 'verify@example.com',
        to: ['customer@example.com'],
        subject: 'Verification',
        html: '<p>Code</p>',
      }),
    }))
    expect(mail.sendMail).not.toHaveBeenCalled()
  })

  it('reports a rejected Resend request as a delivery failure', async () => {
    Object.assign(mailConfig, { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'resend-test-key', SMTP_USER: undefined, SMTP_PASSWORD: undefined })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })))

    await expect(sendEmail('customer@example.com', 'Verification', '<p>Code</p>'))
      .rejects.toMatchObject({ code: 'RESEND_API_ERROR', responseCode: 403 })
  })
})
