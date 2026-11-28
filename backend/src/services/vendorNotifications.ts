import { config } from '../config.js'
import { logger } from '../lib/logger.js'
import { supabase } from '../supabase.js'
import { sendTemplateEmail, type EmailTemplateKey } from './emailTemplates.js'

type VendorDecisionTemplate = Extract<EmailTemplateKey,
  | 'vendor_application_approved'
  | 'vendor_application_rejected'
  | 'vendor_account_approved'
  | 'vendor_account_rejected'
  | 'vendor_profile_approved'
  | 'vendor_profile_rejected'
>

async function notifyVendor(email: string | null | undefined, key: VendorDecisionTemplate, variables: Record<string, string>, event: string) {
  if (!email) {
    logger.warn('vendor.email_notification_skipped', { event, reason: 'No vendor email address' })
    return
  }
  try {
    const result = await sendTemplateEmail(key, email, variables)
    if (!result.queued) logger.warn('vendor.email_not_queued', {
      event,
      template: key,
      reason: result.reason ?? 'Email delivery was not queued',
    })
  } catch (error) {
    logger.warn('vendor.email_notification_failed', {
      event,
      template: key,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

export async function notifyVendorByEmail(
  email: string | null | undefined,
  key: VendorDecisionTemplate,
  variables: Record<string, string>,
  event: string,
) {
  return notifyVendor(email, key, variables, event)
}

export async function notifyVendorByProfileId(
  profileId: string | null | undefined,
  key: VendorDecisionTemplate,
  variables: Record<string, string>,
  event: string,
) {
  if (!profileId) return notifyVendor(null, key, variables, event)
  let email: string | null | undefined
  try {
    const { data, error } = await supabase.auth.admin.getUserById(profileId)
    if (error) throw new Error(error.message)
    email = data.user?.email
  } catch (error) {
    logger.warn('vendor.email_recipient_lookup_failed', {
      event,
      profileId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return
  }
  return notifyVendor(email, key, { ...variables, loginUrl: `${config.FRONTEND_ORIGIN}/login` }, event)
}
