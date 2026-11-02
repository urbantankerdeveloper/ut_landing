import { describe, expect, it, vi } from 'vitest'

const mail = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({})) }))

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ sendMail: mail.sendMail })) } }))

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

import { notifyUser } from './providers.js'

describe('notifyUser', () => {
  it('escapes the message before it is placed in the email HTML', async () => {
    await notifyUser({ email: 'customer@example.com' }, 'Your fleet', 'Ref <b>UT1</b> & "more"')
    expect(mail.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      html: '<p>Ref &lt;b&gt;UT1&lt;/b&gt; &amp; &quot;more&quot;</p>',
    }))
  })
})
