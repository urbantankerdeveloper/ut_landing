// Indian mobile numbers are stored in E.164 form (+91XXXXXXXXXX) so one number has one spelling.
export function toE164IndianMobile(input: string): string | null {
  const trimmed = input.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`
  if (/^91[6-9]\d{9}$/.test(digits) && (trimmed.startsWith('+') || digits.length === 12)) return `+${digits}`
  return null
}
