import { describe, expect, it, vi } from 'vitest'
import { requireRole } from './auth.js'

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

describe('protected route role boundaries', () => {
  it.each([
    ['customer', ['customer'], 200],
    ['vendor', ['vendor'], 200],
    ['admin', ['admin'], 200],
    ['dispatcher', ['admin', 'dispatcher'], 200],
    ['customer-to-admin', ['admin'], 403],
    ['vendor-to-customer', ['customer'], 403],
    ['dispatcher-to-vendor', ['vendor'], 403],
  ])('%s role access returns the expected result', (role, allowed, expected) => {
    const next = vi.fn()
    const res = response()
    requireRole(...allowed)({ profile: { role } } as never, res as never, next)
    if (expected === 200) expect(next).toHaveBeenCalledOnce()
    else expect(res.status).toHaveBeenCalledWith(403)
  })
})
