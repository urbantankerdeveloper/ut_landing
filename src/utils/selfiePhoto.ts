export const selfieMaxBytes = 3 * 1024 * 1024
const selfieMaxSide = 1080
const selfieJpegQuality = 0.8

export function base64FromBytes(bytes: Uint8Array) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

// Converts any browser-readable photo to a JPEG no wider or taller than 1080 px, like the mobile app.
export async function prepareSelfieJpeg(file: File): Promise<Uint8Array<ArrayBuffer>> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This photo format cannot be used. Choose a JPEG, PNG or WebP photo.')
  }
  const scale = Math.min(1, selfieMaxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This photo could not be prepared. Try another photo.')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', selfieJpegQuality))
  if (!blob) throw new Error('This photo could not be prepared. Try another photo.')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length > selfieMaxBytes) throw new Error('The photo is larger than 3 MB. Choose a smaller photo.')
  return bytes
}
