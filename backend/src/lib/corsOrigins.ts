// Origins are compared exactly, the way browsers send the Origin header (scheme, host and port, no path).
export function isAllowedCorsOrigin(origin: string | undefined, allowedOrigins: readonly string[], nodeEnv: string | undefined) {
  if (!origin) return true
  if (allowedOrigins.includes(origin)) return true
  return nodeEnv !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

// Returns the first problem with CORS_ORIGINS, or null. In production every entry must be an https origin.
export function corsOriginProblem(origins: readonly string[], nodeEnv: string | undefined): string | null {
  if (nodeEnv !== 'production') return null
  for (const origin of origins) {
    let parsed: URL
    try {
      parsed = new URL(origin)
    } catch {
      return `CORS_ORIGINS entry is not a valid URL: ${origin}`
    }
    if (parsed.protocol !== 'https:' || parsed.origin !== origin) {
      return `CORS_ORIGINS entries must be https origins without a path in production: ${origin}`
    }
  }
  return null
}
