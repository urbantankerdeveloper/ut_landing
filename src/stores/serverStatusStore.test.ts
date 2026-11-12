import { afterEach, describe, expect, it } from 'vitest'
import { useServerStatusStore } from './serverStatusStore'

afterEach(() => {
  useServerStatusStore.setState({ slowRequests: 0, noticeVisible: false, hasShownNotice: false })
})

describe('server status notice', () => {
  it('shows once per page while the first slow requests are pending', () => {
    const store = useServerStatusStore.getState()
    store.markSlow()
    expect(useServerStatusStore.getState().noticeVisible).toBe(true)

    useServerStatusStore.getState().markSlow()
    useServerStatusStore.getState().markSettled()
    expect(useServerStatusStore.getState().noticeVisible).toBe(true)

    useServerStatusStore.getState().markSettled()
    expect(useServerStatusStore.getState().noticeVisible).toBe(false)

    useServerStatusStore.getState().markSlow()
    expect(useServerStatusStore.getState().noticeVisible).toBe(false)
  })
})
