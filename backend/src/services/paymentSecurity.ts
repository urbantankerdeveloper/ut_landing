import crypto from 'node:crypto'

export function signaturesMatch(expected: string, received: string) {
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const receivedBuffer = Buffer.from(received, 'utf8')
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
}

export function refundAmountInPaise(requestedAmount: number | undefined, capturedAmount: number) {
  if (!Number.isInteger(capturedAmount) || capturedAmount <= 0) throw new Error('Payment amount is invalid')
  if (requestedAmount === undefined) return capturedAmount
  const amount = Math.round(requestedAmount * 100)
  if (!Number.isInteger(amount) || amount <= 0 || amount > capturedAmount) throw new Error('Refund amount exceeds the captured payment')
  return amount
}
