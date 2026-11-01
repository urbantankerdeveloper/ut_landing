import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const base = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }

describe('production configuration guards', () => {
  const original = { ...process.env }
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { process.env = { ...original } })

  it('refuses the fixed fallback verification code in production', async () => {
    process.env = { ...original, ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://app.example.com', USE_DEFAULT_VERIFICATION_CODE: 'true' }
    await expect(import('./config.js')).rejects.toThrow('USE_DEFAULT_VERIFICATION_CODE must be false in production')
  })

  it('requires a database CA certificate in production when a database URL is set', async () => {
    process.env = { ...original, ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://app.example.com', SUPABASE_DB_URL: 'postgresql://u:p@h:5432/db' }
    await expect(import('./config.js')).rejects.toThrow('DB_SSL_CA is required in production')
  })

  it('accepts a production config with the CA and the fallback disabled', async () => {
    process.env = { ...original, ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://app.example.com', SUPABASE_DB_URL: 'postgresql://u:p@h:5432/db', DB_SSL_CA: 'line1\\nline2' }
    const { config } = await import('./config.js')
    expect(config.DB_SSL_CA).toBe('line1\nline2')
  })

  it('reads the comma-separated CORS origin list', async () => {
    process.env = { ...original, ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://app.example.com', CORS_ORIGINS: 'https://urbantanker.com, https://www.urbantanker.com ,' }
    const { config } = await import('./config.js')
    expect(config.CORS_ORIGINS).toEqual(['https://urbantanker.com', 'https://www.urbantanker.com'])
  })
})
