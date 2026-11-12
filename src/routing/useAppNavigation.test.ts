import { afterEach, describe, expect, it } from 'vitest'
import { needsLeaveConfirmation } from './useAppNavigation'
import { useNavigationStore } from '../stores/navigationStore'

afterEach(() => {
  useNavigationStore.getState().setBookingCompleted(false)
  useNavigationStore.getState().setPartnerFormDirty(false)
})

describe('needsLeaveConfirmation', () => {
  it('blocks leaving an incomplete booking', () => {
    expect(needsLeaveConfirmation('/booking', '/')).toBe(true)
  })

  it('allows leaving a completed booking', () => {
    useNavigationStore.getState().setBookingCompleted(true)

    expect(needsLeaveConfirmation('/booking', '/')).toBe(false)
  })

  it('continues to block leaving a dirty partner form', () => {
    useNavigationStore.getState().setPartnerFormDirty(true)

    expect(needsLeaveConfirmation('/partner', '/')).toBe(true)
  })
})
