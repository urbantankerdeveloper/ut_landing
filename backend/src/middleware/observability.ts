import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

export function requestObservability(request: Request, response: Response, next: NextFunction) {
  const requestId = request.header('x-request-id') ?? crypto.randomUUID()
  const startedAt = process.hrtime.bigint()
  response.locals.requestId = requestId
  response.setHeader('x-request-id', requestId)
  response.on('finish', () => { const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000; console.info(JSON.stringify({ event: 'http.request', requestId, method: request.method, path: request.originalUrl, status: response.statusCode, durationMs: Math.round(durationMs * 100) / 100 })) })
  next()
}
