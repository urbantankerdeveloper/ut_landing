import type { ErrorRequestHandler } from 'express'
import { loggablePath } from './observability.js'
export const errorHandler: ErrorRequestHandler = (error, request, response, next) => {
  if (response.headersSent) {
    next(error)
    return
  }
  const requestId = response.locals.requestId
  const candidateStatus = Number(error?.statusCode ?? error?.status)
  const statusCode = Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus <= 599 ? candidateStatus : 500
  console.error(JSON.stringify({ event: 'http.error', requestId, method: request.method, path: loggablePath(request.path), status: statusCode, error: error instanceof Error ? error.message : String(error) }))
  response.status(statusCode).json({ error: statusCode >= 500 ? 'Internal server error' : error?.message ?? 'Request failed', requestId })
}
