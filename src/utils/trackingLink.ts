const mobileUserAgent = /Android|iPhone|iPad|iPod/i

export function isMobileUserAgent(userAgent: string) {
  return mobileUserAgent.test(userAgent)
}

export function appTrackingLink(token: string) {
  return `urbantanker://track/${token}`
}
