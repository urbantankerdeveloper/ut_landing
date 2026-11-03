import { mailErrorCode } from './providers.js'

export type SignupConfirmationOutcome = { sent: true } | { sent: false; reason: string; cleanedUp: boolean }

/**
 * Sends the signup confirmation email before the signup reply is sent. If the
 * email is not sent, the unconfirmed account is removed, so the app is never
 * told that an email went out when it did not.
 *
 * `send` and `rollback` are passed in so the decision can be tested without a
 * mail server or a database.
 */
export async function sendSignupConfirmation(options: {
  send: () => Promise<{ queued: boolean; reason?: string }>
  rollback: () => Promise<boolean>
}): Promise<SignupConfirmationOutcome> {
  let reason: string
  try {
    const delivery = await options.send()
    if (delivery.queued) return { sent: true }
    reason = delivery.reason ?? 'The mail provider did not accept the message.'
  } catch (error) {
    reason = mailErrorCode(error)
  }
  const cleanedUp = await options.rollback().catch(() => false)
  return { sent: false, reason, cleanedUp }
}
