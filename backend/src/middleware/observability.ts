import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

export function requestObservability(request: Request, response: Response, next: NextFunction) {
  const suppliedRequestId = request.header('x-request-id')
  const requestId = suppliedRequestId && /^[a-zA-Z0-9._:-]{1,128}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID()
  const startedAt = process.hrtime.bigint()
  response.locals.requestId = requestId
  response.setHeader('x-request-id', requestId)
  response.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    console.info(JSON.stringify({ event: 'http.request', requestId, method: request.method, path: request.path, status: response.statusCode, durationMs: Math.round(durationMs * 100) / 100 }))
  })
  next()
}
