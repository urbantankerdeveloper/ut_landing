import { describe, expect, it } from 'vitest'
import { formatLogLine } from './logger.js'

const time = new Date('2025-01-02T03:04:05.678Z')

describe('formatLogLine', () => {
  it('prints one colorless line with key=value fields in development', () => {
    const line = formatLogLine('success', 'http.request', { method: 'GET', path: '/api/health', status: 200, skipped: undefined }, { pretty: true, color: false, time })

    expect(line).toBe('03:04:05.678 SUCCESS http.request method=GET path=/api/health status=200')
  })

  it('quotes values that contain spaces or other special characters', () => {
    const line = formatLogLine('error', 'sms_failed', { error: 'bad gateway: timeout' }, { pretty: true, color: false, time })

    expect(line).toContain('error="bad gateway: timeout"')
  })

  it('wraps the stamp and label in color codes when color is on', () => {
    const line = formatLogLine('warn', 'slow_request', {}, { pretty: true, color: true, time })

    expect(line).toContain('\x1b[33mWARN   \x1b[0m')
  })

  it('prints a JSON object per line outside development', () => {
    const line = formatLogLine('info', 'server.listening', { port: 8080 }, { pretty: false, color: false, time })

    expect(JSON.parse(line)).toEqual({ time: '2025-01-02T03:04:05.678Z', level: 'info', event: 'server.listening', port: 8080 })
  })
})
