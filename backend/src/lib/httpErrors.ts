import type { Response } from 'express'
import { logger } from './logger.js'

export function describeError(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}

export function failure(response: Response, status: number, message: string, event?: string, error?: unknown) {
  if (event) logger.warn(event, { requestId: response.locals.requestId, status, error: error === undefined ? undefined : describeError(error) })
  return response.status(status).json({ error: message })
}

export function databaseFailure(response: Response, event: string, error: unknown, status = 400, message = 'Request could not be completed. Please try again.') {
  if ((error as { code?: string } | null)?.code === '23505') return failure(response, 409, 'This record already exists.', event, error)
  return failure(response, status, message, event, error)
}
