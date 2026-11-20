export class ApiError extends Error {
  status: number
  // The message the server sent in its response body. Only this is safe to show to people.
  serverMessage?: string
  code?: string
  retryAfterSeconds?: number
  constructor(message: string, status: number, serverMessage?: string, code?: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.serverMessage = serverMessage
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}
