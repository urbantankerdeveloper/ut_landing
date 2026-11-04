import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const base = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', SUPABASE_DB_URL: '', OTP_HMAC_SECRET: 'x'.repeat(32) }

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

  it('requires booking phone verification by default and allows the setting to be disabled', async () => {
    process.env = { ...original, ...base, NODE_ENV: 'test' }
    const defaultConfig = await import('./config.js')
    expect(defaultConfig.config.REQUIRE_BOOKING_PHONE_VERIFICATION).toBe(true)

    vi.resetModules()
    process.env.REQUIRE_BOOKING_PHONE_VERIFICATION = 'false'
    const disabledConfig = await import('./config.js')
    expect(disabledConfig.config.REQUIRE_BOOKING_PHONE_VERIFICATION).toBe(false)
  })

  it('reads the comma-separated CORS origin list', async () => {
    process.env = { ...original, ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://app.example.com', CORS_ORIGINS: 'https://urbantanker.com, https://www.urbantanker.com ,' }
    const { config } = await import('./config.js')
    expect(config.CORS_ORIGINS).toEqual(['https://urbantanker.com', 'https://www.urbantanker.com'])
  })

  it('treats blank values from .env.example as unset', async () => {
    process.env = { ...original, ...base, SUPABASE_SECRET_KEY: '', SUPABASE_DB_URL: '', ADMIN_REGISTRATION_KEY: '' }
    const { config } = await import('./config.js')
    expect(config.SUPABASE_DB_URL).toBeUndefined()
    expect(config.SUPABASE_SERVICE_ROLE_KEY).toBe('k')
  })

  it('drops a trailing slash from FRONTEND_ORIGIN so it matches the browser Origin header', async () => {
    process.env = { ...original, ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://urbantanker.in/' }
    const { config } = await import('./config.js')
    expect(config.FRONTEND_ORIGIN).toBe('https://urbantanker.in')
  })

  it('explains how to fix a missing required variable', async () => {
    process.env = { ...original, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: 'k' }
    await expect(import('./config.js')).rejects.toThrow('Copy backend/.env.example to backend/.env')
  })

  it('requires NODE_ENV to be set explicitly', async () => {
    process.env = { ...original, ...base, NODE_ENV: '' }
    await expect(import('./config.js')).rejects.toThrow('NODE_ENV must be set to development, test, or production')
  })

  it('requires a TLS Redis URL in production', async () => {
    process.env = { ...original, ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://app.example.com', REDIS_URL: 'redis://cache.example.com:6379' }
    await expect(import('./config.js')).rejects.toThrow('rediss://')
  })

  it('requires https CORS origins in production', async () => {
    process.env = { ...original, ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://app.example.com', CORS_ORIGINS: 'http://urbantanker.com' }
    await expect(import('./config.js')).rejects.toThrow('CORS_ORIGINS entries must be https origins')
  })
})
