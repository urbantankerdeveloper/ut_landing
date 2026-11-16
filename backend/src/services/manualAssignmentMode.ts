import { config } from '../config.js'
import { supabase } from '../supabase.js'

const settingKey = 'manual_assignment_mode_enabled'

export async function getManualAssignmentModeEnabled() {
  const { data, error } = await supabase
    .from('configs')
    .select('value')
    .eq('key', settingKey)
    .maybeSingle()
  if (error) throw error
  if (!data) return config.featureFlags.manual_assignment_mode_enabled
  if (typeof data.value !== 'boolean') {
    throw new Error('The manual assignment setting must be a boolean.')
  }
  return data.value
}

export async function setManualAssignmentModeEnabled(enabled: boolean) {
  const { data, error } = await supabase
    .from('configs')
    .upsert({
      key: settingKey,
      value: enabled,
      updated_at: new Date().toISOString(),
    })
    .select('value')
    .single()
  if (error) throw error
  if (!data || typeof data.value !== 'boolean') {
    throw new Error('The manual assignment setting could not be saved.')
  }
  return data.value
}
