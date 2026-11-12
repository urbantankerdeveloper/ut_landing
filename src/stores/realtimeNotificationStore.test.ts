import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRealtimeNotificationStore } from './realtimeNotificationStore'

describe('useRealtimeNotificationStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    useRealtimeNotificationStore.getState().clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts a business fact once even when two events describe it', () => {
    const { recordFact } = useRealtimeNotificationStore.getState()
    recordFact('booking:b1:accepted')
    recordFact('booking:b1:accepted')
    expect(useRealtimeNotificationStore.getState().unread).toBe(1)
  })

  it('counts the same fact again once the dedupe window has passed', () => {
    const { recordFact } = useRealtimeNotificationStore.getState()
    recordFact('offer:b2')
    vi.advanceTimersByTime(11_000)
    recordFact('offer:b2')
    expect(useRealtimeNotificationStore.getState().unread).toBe(2)
  })

  it('resets the count when cleared', () => {
    useRealtimeNotificationStore.getState().recordFact('taken:b3')
    useRealtimeNotificationStore.getState().clear()
    expect(useRealtimeNotificationStore.getState().unread).toBe(0)
  })
})
