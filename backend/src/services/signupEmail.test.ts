import { describe, expect, it } from 'vitest'
import { emailCodeEmail, passwordResetEmail, signupConfirmationEmail } from './signupEmail.js'

describe('email verification code email', () => {
  it('shows the code and expiry for each purpose', () => {
    const signIn = emailCodeEmail('123456', 'sign_in')
    expect(signIn.subject).toContain('sign-in')
    expect(signIn.html).toContain('123456')
    expect(signIn.html).toContain('10 minutes')
    expect(emailCodeEmail('123456', 'signup').html).toContain('finish creating your account')
    expect(emailCodeEmail('123456', 'link').html).toContain('new email address')
  })
})

describe('signup confirmation email', () => {
  it('includes the confirmation action link', () => {
    const message = signupConfirmationEmail('Asha', 'https://example.com/confirm?token=abc')
    expect(message.subject).toContain('Confirm')
    expect(message.html).toContain('href="https://example.com/confirm?token=abc"')
  })

  it('escapes user-controlled HTML in the name and URL', () => {
    const message = signupConfirmationEmail('<img src=x>', 'https://example.com/?a=1&b=2')
    expect(message.html).toContain('&lt;img src=x&gt;')
    expect(message.html).not.toContain('<img src=x>')
    expect(message.html).toContain('a=1&amp;b=2')
  })

  it('includes a safe password recovery link', () => {
    const message = passwordResetEmail('https://example.com/reset?token=abc')
    expect(message.subject).toContain('Reset')
    expect(message.html).toContain('href="https://example.com/reset?token=abc"')
  })
})
