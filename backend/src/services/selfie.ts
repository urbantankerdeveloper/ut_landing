export const selfieBucket = 'customer-selfies'
export const selfieMaxBytes = 3 * 1024 * 1024

export function selfieObjectPath(customerId: string) {
  return `${customerId}/selfie.jpg`
}

export function isJpeg(bytes: Buffer) {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

export function decodeSelfieJpeg(base64: string) {
  const bytes = Buffer.from(base64, 'base64')
  return bytes.length > 0 && bytes.length <= selfieMaxBytes && isJpeg(bytes) ? bytes : null
}
