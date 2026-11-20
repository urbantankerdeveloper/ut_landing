export type PhoneOtpChannel = 'whatsapp' | 'sms'

export function canSkipPhoneVerification(required: boolean | undefined) {
  return required === false
}

export function phoneOtpDeliveryCopy(channel: PhoneOtpChannel, phone: string) {
  return `We sent a code via ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} to +91 ${phone}.`
}

export function pastedOtpDigits(text: string) {
  return text.replace(/\D/g, '').slice(0, 6)
}
