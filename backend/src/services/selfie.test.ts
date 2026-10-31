import { describe, expect, it } from 'vitest'
import { isJpeg, decodeSelfieJpeg, selfieMaxBytes, selfieObjectPath } from './selfie.js'

const customerId = '6f1c2b4e-1111-4a2b-9c3d-0123456789ab'

describe('selfie storage', () => {
  it('stores each customer selfie at a fixed path under the customer id', () => {
    expect(selfieObjectPath(customerId)).toBe(`${customerId}/selfie.jpg`)
  })

  it('accepts only real JPEG data', () => {
    expect(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe(true)
    expect(isJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe(false)
    expect(isJpeg(Buffer.from([]))).toBe(false)
  })

  it('decodes a JPEG sent as base64 and rejects other data', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    expect(decodeSelfieJpeg(jpeg.toString('base64'))?.equals(jpeg)).toBe(true)
    expect(decodeSelfieJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'))).toBeNull()
    expect(decodeSelfieJpeg('')).toBeNull()
  })

  it('rejects a base64 JPEG larger than 3 MB', () => {
    const tooLarge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(selfieMaxBytes)])
    expect(decodeSelfieJpeg(tooLarge.toString('base64'))).toBeNull()
  })
})
