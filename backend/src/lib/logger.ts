import { config } from '../config.js'

export type LogLevel = 'error' | 'warn' | 'success' | 'info' | 'debug'
export type LogFields = Record<string, unknown>

const priority: Record<LogLevel, number> = { error: 0, warn: 1, success: 2, info: 3, debug: 4 }
const colors: Record<LogLevel, string> = { error: '\x1b[31m', warn: '\x1b[33m', success: '\x1b[32m', info: '\x1b[36m', debug: '\x1b[90m' }
const labels: Record<LogLevel, string> = { error: 'ERROR  ', warn: 'WARN   ', success: 'SUCCESS', info: 'INFO   ', debug: 'DEBUG  ' }

const ansiReset = '\x1b[0m'
const dim = '\x1b[2m'

export type LineOptions = { pretty: boolean; color: boolean; time?: Date }

const formatValue = (value: unknown) => {
  if (typeof value === 'string' && /^[\w.:/@+-]+$/.test(value)) return value
  return JSON.stringify(value)
}

// Pure formatter so the output shape can be tested without touching the console.
export function formatLogLine(level: LogLevel, event: string, fields: LogFields, options: LineOptions) {
  const time = options.time ?? new Date()
  if (!options.pretty) return JSON.stringify({ time: time.toISOString(), level, event, ...fields })
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
  const stamp = time.toISOString().slice(11, 23)
  const label = labels[level]
  const colorize = (text: string, code: string) => (options.color ? `${code}${text}${ansiReset}` : text)
  return [
    colorize(stamp, dim),
    colorize(label, colors[level]),
    event,
    ...parts,
  ].join(' ')
}

const threshold = priority[config.LOG_LEVEL]
const pretty = config.NODE_ENV === 'development'
const color = pretty && Boolean(process.stdout.isTTY) && !process.env.NO_COLOR

function emit(level: LogLevel, event: string, fields: LogFields = {}) {
  if (priority[level] > threshold) return
  const line = formatLogLine(level, event, fields, { pretty, color })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  error: (event: string, fields?: LogFields) => emit('error', event, fields),
  warn: (event: string, fields?: LogFields) => emit('warn', event, fields),
  success: (event: string, fields?: LogFields) => emit('success', event, fields),
  info: (event: string, fields?: LogFields) => emit('info', event, fields),
  debug: (event: string, fields?: LogFields) => emit('debug', event, fields),
}

export const logging = { pretty, level: config.LOG_LEVEL }
