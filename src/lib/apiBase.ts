const DEFAULT_API_ORIGIN = 'https://api.urbantanker.in'
const configuredApiUrl = import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_ORIGIN

export const API_ORIGIN = new URL(configuredApiUrl).origin.replace(/\/+$/, '')
export const API_URL = `${API_ORIGIN}/api`
export const SOCKET_URL = API_ORIGIN
