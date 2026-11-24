type AnalyticsPayload = Record<string, string | number | boolean | undefined>
const sessionStorageKey = 'urban-tanker-analytics-session'
const sessionId = () => {
  const existing = sessionStorage.getItem(sessionStorageKey)
  if (existing) return existing
  const generated = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  sessionStorage.setItem(sessionStorageKey, generated)
  return generated
}

const analyticsBatch: Array<{ eventName: string; sessionId: string; properties: Record<string, string | number | boolean> }> = []
let analyticsFlushTimer: number | null = null

function flushAnalytics() {
  if (!analyticsBatch.length) return
  const endpoint = `${import.meta.env.VITE_API_BASE_URL ?? '/api'}/analytics/events`
  const events = analyticsBatch.splice(0, analyticsBatch.length)
  const body = JSON.stringify({ events })
  if (navigator.sendBeacon) {
    navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))
  } else {
    void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => undefined)
  }
}

export function trackEvent(name: string, payload: AnalyticsPayload = {}) {
  const event = { name, payload, at: new Date().toISOString() }
  if (import.meta.env.DEV) console.debug(`[analytics] ${name}`, payload)
  window.dispatchEvent(new CustomEvent('urban-tanker-analytics', { detail: event }))
  const properties = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
  if (import.meta.env.VITE_ANALYTICS_BATCH === 'true') {
    const safeProperties = Object.fromEntries(
      Object.entries(properties).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined),
    )
    analyticsBatch.push({ eventName: name, sessionId: sessionId(), properties: safeProperties })
    if (analyticsFlushTimer === null) {
      analyticsFlushTimer = window.setTimeout(() => {
        analyticsFlushTimer = null
        flushAnalytics()
      }, 2_000)
    }
    window.addEventListener('pagehide', flushAnalytics, { once: true })
  } else {
    void fetch(`${import.meta.env.VITE_API_BASE_URL ?? '/api'}/analytics/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ eventName: name, sessionId: sessionId(), properties }),
      keepalive: true,
    }).catch(() => undefined)
  }
}
