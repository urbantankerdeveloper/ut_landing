import { useServerStatusStore } from '../stores/serverStatusStore'
import { chromeContent as c } from '../content/chrome'

// Non-blocking: the region is always mounted so screen readers announce it when it appears.
export function ServerWakingNotice() {
  const slowRequests = useServerStatusStore((state) => state.slowRequests)
  return <div className="server-waking-notice" role="status" aria-live="polite" hidden={slowRequests === 0}>{c.serverStatus.wakingUp}</div>
}
