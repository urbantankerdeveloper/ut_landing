import { beforeEach, describe, expect, it, vi } from 'vitest'

const mail = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({})) }))
const mailConfig = vi.hoisted(() => ({
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: 465,
  SMTP_SECURE: true,
  SMTP_USER: 'mailer@example.com' as string | undefined,
  SMTP_PASSWORD: 'secret' as string | undefined,
  MAIL_FROM: 'mailer@example.com' as string | undefined,
}))

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ sendMail: mail.sendMail })) } }))

vi.mock('../config.js', () => ({ config: mailConfig }))

import { notifyUser } from './providers.js'

describe('notifyUser', () => {
  beforeEach(() => {
    mail.sendMail.mockClear()
    Object.assign(mailConfig, { SMTP_USER: 'mailer@example.com', SMTP_PASSWORD: 'secret', MAIL_FROM: 'mailer@example.com' })
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
})
