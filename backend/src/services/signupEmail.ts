function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

export function signupConfirmationEmail(name: string, actionLink: string) {
  const safeName = escapeHtml(name)
  const safeActionLink = escapeHtml(actionLink)
  return {
    subject: 'Confirm your Urban Tanker account',
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#173b35"><h1>Welcome to Urban Tanker, ${safeName}</h1><p>Confirm your email address to finish creating your customer account.</p><p style="margin:28px 0"><a href="${safeActionLink}" style="background:#087f70;color:#fff;padding:13px 20px;border-radius:6px;text-decoration:none">Confirm email address</a></p><p>If the button does not work, copy this link into your browser:</p><p><a href="${safeActionLink}">${safeActionLink}</a></p><p>If you did not create this account, you can ignore this email.</p></div>`,
  }
}

export function emailCodeEmail(code: string, purpose: 'sign_in' | 'signup' | 'link') {
  const intro = {
    sign_in: 'Use this code to sign in to Urban Tanker.',
    signup: 'Use this code to confirm your email address and finish creating your account.',
    link: 'Use this code to confirm the new email address on your Urban Tanker account.',
  }[purpose]
  const subject = purpose === 'sign_in' ? 'Your Urban Tanker sign-in code' : 'Your Urban Tanker verification code'
  return {
    subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#173b35"><h1>Your verification code</h1><p>${intro}</p><p style="margin:28px 0;font-size:28px;letter-spacing:6px;font-weight:bold">${escapeHtml(code)}</p><p>This code expires in 10 minutes. Do not share it with anyone.</p><p>If you did not request this, you can ignore this email.</p></div>`,
  }
}

export function passwordResetEmail(actionLink: string) {
  const safeActionLink = escapeHtml(actionLink)
  return {
    subject: 'Reset your Urban Tanker password',
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#173b35"><h1>Reset your password</h1><p>We received a request to reset your Urban Tanker account password.</p><p style="margin:28px 0"><a href="${safeActionLink}" style="background:#087f70;color:#fff;padding:13px 20px;border-radius:6px;text-decoration:none">Reset password</a></p><p>If the button does not work, copy this link into your browser:</p><p><a href="${safeActionLink}">${safeActionLink}</a></p><p>If you did not request this, you can ignore this email.</p></div>`,
  }
}
