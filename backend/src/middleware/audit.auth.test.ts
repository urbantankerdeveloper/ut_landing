import { describe, expect, it } from 'vitest'
import { auditBodySnapshot } from './auth.js'

describe('auditBodySnapshot', () => {
  it('skips raw buffer bodies', () => {
    expect(auditBodySnapshot(Buffer.from('{"status":"paid"}'))).toBeUndefined()
  })
  it('keeps only allow-listed fields and omits everything else', () => {
    expect(auditBodySnapshot({ status: 'cancelled', phone: '+919876543210', otp: '123456', notes: 'call me', rating: 5 })).toEqual({
      status: 'cancelled',
      phone: '[omitted]',
      otp: '[omitted]',
      notes: '[omitted]',
      rating: 5,
    })
  })
  it('does not expose nested contact data through allow-listed parents', () => {
    expect(auditBodySnapshot({ services: [{ phone: '+919876543210', location: 'x' }] })).toEqual({ services: '[omitted]' })
  })
  it('returns undefined for missing bodies', () => {
    expect(auditBodySnapshot(undefined)).toBeUndefined()
    expect(auditBodySnapshot('text')).toBeUndefined()
  })
})
