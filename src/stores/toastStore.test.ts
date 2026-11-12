import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from './toastStore'

describe('toastStore', () => {
  beforeEach(() => {
    // The store schedules dismissals through window.setTimeout; the node test environment has no window.
    vi.stubGlobal('window', globalThis)
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('removes transient toasts after their duration', () => {
    useToastStore.getState().push('info', 'Transient notice')
    vi.advanceTimersByTime(4_001)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('keeps a sticky toast open until it is dismissed by key', () => {
    useToastStore.getState().push('info', 'Sticky offer', { key: 'offer:sticky-1', sticky: true })
    vi.advanceTimersByTime(60_000)
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(['Sticky offer'])

    useToastStore.getState().dismissByKey('offer:sticky-1')
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('does not show a second sticky toast with a key that is already open', () => {
    useToastStore.getState().push('info', 'First offer', { key: 'offer:dup-1', sticky: true })
    useToastStore.getState().push('info', 'Second offer', { key: 'offer:dup-1', sticky: true })
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(['First offer'])
  })

  it('evicts transient toasts before a sticky offer when the region is full', () => {
    useToastStore.getState().push('info', 'Open offer', { key: 'offer:keep-1', sticky: true })
    for (let index = 1; index <= 5; index += 1) useToastStore.getState().push('info', `Notice ${index}`)
    const messages = useToastStore.getState().toasts.map((toast) => toast.message)
    expect(messages).toContain('Open offer')
    expect(messages).toHaveLength(4)
  })
})
