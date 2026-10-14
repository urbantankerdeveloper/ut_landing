import { config } from '../config.js'

export async function sendEmail(to: string, subject: string, html: string) {
  const key = config.RESEND_API_KEY
  if (!key) return { queued: false, reason: 'RESEND_API_KEY not configured' }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.MAIL_FROM ?? 'Urban Tanker <no-reply@urbantanker.com>', to, subject, html }),
  })
  if (!response.ok) throw new Error(`Email provider failed: ${response.status}`)
  return { queued: true }
}

export async function sendSms(to: string, body: string) {
  const sid = config.TWILIO_ACCOUNT_SID
  const token = config.TWILIO_AUTH_TOKEN
  if (!sid || !token || !config.TWILIO_FROM_NUMBER) return { queued: false, reason: 'Twilio SMS is not configured' }
  const encoded = new URLSearchParams({ To: to, From: config.TWILIO_FROM_NUMBER, Body: body })
  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: encoded,
  })
  if (!response.ok) throw new Error(`SMS provider failed: ${response.status}`)
  return { queued: true }
}

export async function sendWhatsApp(to: string, body: string) {
  return sendSms(`whatsapp:${to}`, body)
}

export async function notifyUser(to: { email?: string; phone?: string; whatsapp?: string }, subject: string, message: string) {
  return Promise.all([
    to.email ? sendEmail(to.email, subject, `<p>${message}</p>`) : Promise.resolve({ queued: false, reason: 'No email' }),
    to.phone ? sendSms(to.phone, message) : Promise.resolve({ queued: false, reason: 'No phone' }),
    to.whatsapp ? sendWhatsApp(to.whatsapp, message) : Promise.resolve({ queued: false, reason: 'No WhatsApp' }),
  ])
}
