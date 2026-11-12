export type DeliveryVerificationMethod = 'otp' | 'photo'

export function deliveryVerificationMethod(input: {
  otp?: string
  smsSent: boolean | null
  proofPath?: string
}): DeliveryVerificationMethod | null {
  if (input.otp) return 'otp'
  if (input.smsSent === false && input.proofPath?.trim()) return 'photo'
  return null
}
