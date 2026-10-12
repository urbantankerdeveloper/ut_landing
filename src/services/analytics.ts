type AnalyticsPayload = Record<string, string | number | boolean | undefined>
export function trackEvent(name: string, payload: AnalyticsPayload = {}) { if (import.meta.env.DEV) console.debug(`[analytics] ${name}`, payload); window.dispatchEvent(new CustomEvent('urban-tanker-analytics', { detail: { name, payload, at: new Date().toISOString() } })) }
