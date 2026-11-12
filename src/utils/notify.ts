import { ApiError } from '../api/errors'
import { feedbackContent as c } from '../content/feedback'
import { useToastStore, type ToastAction, type ToastTone } from '../stores/toastStore'

function show(tone: ToastTone, message: string) {
  useToastStore.getState().push(tone, message)
}

export const notifySuccess = (message: string = c.success.saved) => show('success', message)
export const notifyInfo = (message: string) => show('info', message)
export const notifyError = (message: string = c.error.generic) => show('error', message)

// A sticky toast that stays until the user acts on it or [dismissNotice] is called with the same key.
export function notifySticky(key: string, message: string, actions: ToastAction[]) {
  useToastStore.getState().push('info', message, { key, sticky: true, actions })
}
export function dismissNotice(key: string) {
  useToastStore.getState().dismissByKey(key)
}

// Errors already toasted by apiFetch are marked so the query and mutation caches do not toast them again.
const reportedErrors = new WeakSet<object>()
export function markReported(error: unknown) {
  if (typeof error === 'object' && error !== null) reportedErrors.add(error)
}
export function wasReported(error: unknown) {
  return typeof error === 'object' && error !== null && reportedErrors.has(error)
}

// Maps any thrown value to a message that is safe to show. Server text is used only for 4xx responses.
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status >= 400 && error.status < 500 && error.serverMessage) return error.serverMessage
    return c.error.generic
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') return c.error.timeout
  if (error instanceof TypeError) return c.error.network
  return c.error.generic
}
