type AnalyticsPayload = Record<string, string | number | boolean | undefined>
const sessionStorageKey = 'urban-tanker-analytics-session'
const sessionId = () => {
  const existing = sessionStorage.getItem(sessionStorageKey)
  if (existing) return existing
  const generated = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  sessionStorage.setItem(sessionStorageKey, generated)
  return generated
}

export function trackEvent(name: string, payload: AnalyticsPayload = {}) {
  const event = { name, payload, at: new Date().toISOString() }
  if (import.meta.env.DEV) console.debug(`[analytics] ${name}`, payload)
  window.dispatchEvent(new CustomEvent('urban-tanker-analytics', { detail: event }))
  const properties = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
  void fetch(`${import.meta.env.VITE_API_BASE_URL ?? '/api'}/analytics/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ eventName: name, sessionId: sessionId(), properties }),
    keepalive: true,
  }).catch(() => undefined)
}
