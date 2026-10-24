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

export function passwordResetEmail(actionLink: string) {
  const safeActionLink = escapeHtml(actionLink)
  return {
    subject: 'Reset your Urban Tanker password',
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#173b35"><h1>Reset your password</h1><p>We received a request to reset your Urban Tanker account password.</p><p style="margin:28px 0"><a href="${safeActionLink}" style="background:#087f70;color:#fff;padding:13px 20px;border-radius:6px;text-decoration:none">Reset password</a></p><p>If the button does not work, copy this link into your browser:</p><p><a href="${safeActionLink}">${safeActionLink}</a></p><p>If you did not request this, you can ignore this email.</p></div>`,
  }
}
