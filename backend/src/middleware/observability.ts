import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { logger } from '../lib/logger.js'

// Tracking links carry a bearer-style token in the path. Log the route template instead of the token.
export function loggablePath(path: string) {
  return path.replace(/^(\/api\/public\/tracking\/)[^/]+/, '$1:token')
}

const roundMs = (value: number) => Math.round(value * 100) / 100

function failureDetails(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
  const record = body as { error?: unknown; message?: unknown; code?: unknown }
  const rawMessage = typeof record.error === 'string'
    ? record.error
    : typeof record.message === 'string'
      ? record.message
      : undefined
  const message = rawMessage
    ?.replace(/[\r\n\t]+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b\d{6}\b/g, '[redacted-code]')
    .replace(/(?:\+\s*)?\b\d[\d\s().-]{6,}\d\b/g, '[redacted-number]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted-token]')
    .slice(0, 240)
  const code = typeof record.code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(record.code)
    ? record.code
    : undefined
  return { error: message, errorCode: code }
}

// slowRequestMs of 0 turns the slow-request log off.
export function requestObservability(slowRequestMs = 800) {
  return function observe(request: Request, response: Response, next: NextFunction) {
    const suppliedRequestId = request.header('x-request-id')
    const requestId = suppliedRequestId && /^[a-zA-Z0-9._:-]{1,128}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : crypto.randomUUID()
    const startedAt = process.hrtime.bigint()
    const elapsedMs = () => Number(process.hrtime.bigint() - startedAt) / 1_000_000
    response.locals.requestId = requestId
    response.setHeader('x-request-id', requestId)
    const json = response.json.bind(response)
    response.json = ((body?: unknown) => {
      response.locals.failureDetails = failureDetails(body)
      return json(body)
    }) as Response['json']
    // Server-Timing must be set before the headers are written, so it is added at the moment they are.
    const writeHead = response.writeHead as (...args: unknown[]) => Response
    response.writeHead = function timedWriteHead(this: Response, ...args: unknown[]) {
      if (!response.headersSent) response.setHeader('Server-Timing', `total;dur=${roundMs(elapsedMs())}`)
      return writeHead.apply(this, args)
    } as Response['writeHead']
    response.on('finish', () => {
      const durationMs = roundMs(elapsedMs())
      const path = loggablePath(request.path)
      const fields = {
        requestId,
        method: request.method,
        path,
        status: response.statusCode,
        durationMs,
        ...(response.statusCode >= 400 ? response.locals.failureDetails : {}),
      }
      if (response.statusCode >= 500) logger.error('http.request', fields)
      else if (response.statusCode >= 400) logger.warn('http.request', fields)
      else logger.success('http.request', fields)
      if (slowRequestMs > 0 && durationMs >= slowRequestMs) {
        logger.warn('slow_request', { ...fields, thresholdMs: slowRequestMs })
      }
    })
    next()
  }
}
