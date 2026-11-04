import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors'
import { feedbackContent as c } from '../content/feedback'
import { useToastStore } from '../stores/toastStore'
import { describeError, notifyError, notifySuccess } from './notify'

beforeEach(() => vi.stubGlobal('window', globalThis))

describe('describeError', () => {
  it('shows server text only for 4xx API errors', () => {
    expect(describeError(new ApiError('Request failed: 422', 422, 'Enter a valid phone number.'))).toBe('Enter a valid phone number.')
  })

  it('hides server text for 5xx and for 4xx without a message', () => {
    expect(describeError(new ApiError('boom', 500, 'database connection string leaked'))).toBe(c.error.generic)
    expect(describeError(new ApiError('Request failed: 404', 404))).toBe(c.error.generic)
  })

  it('maps network and timeout failures to friendly copy', () => {
    expect(describeError(new TypeError('Failed to fetch'))).toBe(c.error.network)
    expect(describeError(new DOMException('Request timed out', 'TimeoutError'))).toBe(c.error.timeout)
  })

  it('falls back to the generic message for unknown values', () => {
    expect(describeError(new Error('Cannot read properties of undefined'))).toBe(c.error.generic)
  })
})

describe('toast store', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }))

  it('suppresses an identical toast fired again straight away', () => {
    notifyError('Something went wrong.')
    notifyError('Something went wrong.')
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('keeps only the latest four toasts', () => {
    for (let i = 0; i < 6; i += 1) notifySuccess(`Saved ${i}`)
    const messages = useToastStore.getState().toasts.map((toast) => toast.message)
    expect(messages).toHaveLength(4)
    expect(messages[3]).toBe('Saved 5')
  })
})
