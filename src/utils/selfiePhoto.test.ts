import { describe, expect, it } from 'vitest'
import { base64FromBytes, selfieMaxBytes } from './selfiePhoto'

describe('selfie photo helpers', () => {
  it('encodes JPEG bytes as base64 for the signup request', () => {
    expect(base64FromBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('/9j/4A==')
  })

  it('encodes large photos without losing or reordering bytes', () => {
    const bytes = new Uint8Array(200_000).map((_, index) => index % 256)
    const decoded = Uint8Array.from(atob(base64FromBytes(bytes)), (character) => character.charCodeAt(0))
    expect(decoded).toEqual(bytes)
  })

  it('caps the photo at 3 MB, the same limit as the API', () => {
    expect(selfieMaxBytes).toBe(3 * 1024 * 1024)
  })
})
