import { sendEmail, isEmailConfigured } from '../services/providers.js'
import { config } from '../config.js'

// Sends one test email through the same SMTP settings the app uses. Usage: npm run smtp:test -- <recipient>
const recipient = process.argv[2] ?? 'maheshqualis@gmail.com'

if (!isEmailConfigured()) {
  console.log(JSON.stringify({ ok: false, reason: 'SMTP_USER, SMTP_PASSWORD or MAIL_FROM is missing' }))
  process.exit(1)
}

const sentAt = new Date().toISOString()
try {
  const result = await sendEmail(
    recipient,
    'Urban Tanker SMTP test',
    `<p>This is a test email from the Urban Tanker backend.</p><p>Sent at ${sentAt} using ${config.SMTP_HOST}:${config.SMTP_PORT} (secure: ${config.SMTP_SECURE}).</p>`,
  )
  console.log(JSON.stringify({ ok: true, result, to: recipient, host: config.SMTP_HOST, port: config.SMTP_PORT, from: config.MAIL_FROM, sentAt }))
} catch (error) {
  console.log(JSON.stringify({ ok: false, to: recipient, host: config.SMTP_HOST, port: config.SMTP_PORT, error: error instanceof Error ? error.message : String(error) }))
  process.exit(1)
}
