type AuthFailureHandler = (reason: unknown) => void

declare global {
  interface Window {
    google?: typeof google
    gm_authFailure?: () => void
    __urbanTankerMapsReady?: () => void
  }
}

const authFailureHandlers = new Set<AuthFailureHandler>()
let mapScriptPromise: Promise<void> | null = null
let rejectPendingLoad: ((reason: Error) => void) | null = null

export function loadGoogleMapsApi(apiKey: string, onAuthFailure: AuthFailureHandler) {
  authFailureHandlers.add(onAuthFailure)
  window.gm_authFailure = () => {
    const error = new Error('Google Maps reported an authentication, billing, or API restriction failure')
    authFailureHandlers.forEach((handler) => handler(error))
    rejectPendingLoad?.(error)
  }

  if (window.google?.maps) return Promise.resolve()
  if (mapScriptPromise) return mapScriptPromise

  mapScriptPromise = new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      window.__urbanTankerMapsReady = undefined
      rejectPendingLoad = null
      if (error) reject(error)
      else resolve()
    }
    const timeout = window.setTimeout(() => finish(new Error('Google Maps API did not load within 15 seconds')), 15_000)
    rejectPendingLoad = (error) => finish(error)

    const script = document.createElement('script')
    script.async = true
    script.defer = true
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=__urbanTankerMapsReady&loading=async&v=weekly`
    script.onerror = () => finish(new Error('Google Maps API script failed to load'))
    window.__urbanTankerMapsReady = () => {
      if (!window.google?.maps) {
        finish(new Error('Google Maps API loaded without exposing the Maps JavaScript API'))
        return
      }
      finish()
    }
    document.head.appendChild(script)
  })

  return mapScriptPromise
}
