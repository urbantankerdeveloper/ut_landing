export class ApiError extends Error {
  status: number
  // The message the server sent in its response body. Only this is safe to show to people.
  serverMessage?: string
  constructor(message: string, status: number, serverMessage?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.serverMessage = serverMessage
  }
}
