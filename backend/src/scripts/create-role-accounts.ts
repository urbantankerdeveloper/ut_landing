import crypto from 'node:crypto'
import { authSupabase, supabase } from '../supabase.js'

type Role = 'customer' | 'vendor' | 'dispatcher' | 'admin'
type Account = { role: Role; email: string; name: string; phone: string }

const accounts: Account[] = [
  { role: 'customer', email: 'customer.test@urbantanker.in', name: 'Urban Test Customer', phone: '9000000001' },
  { role: 'vendor', email: 'vendor.test@urbantanker.in', name: 'Urban Test Vendor', phone: '9000000002' },
  { role: 'dispatcher', email: 'dispatcher.test@urbantanker.in', name: 'Urban Test Dispatcher', phone: '9000000003' },
  { role: 'admin', email: 'admin.test@urbantanker.in', name: 'Urban Test Admin', phone: '9000000004' },
]

function password() { return `UT-${crypto.randomBytes(12).toString('base64url')}` }

const listed = await authSupabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listed.error) throw listed.error
const credentials: string[] = []
for (const account of accounts) {
  const secret = password()
  const existing = listed.data.users.find((user) => user.email?.toLowerCase() === account.email)
  const authResult = existing
    ? await authSupabase.auth.admin.updateUserById(existing.id, { password: secret, email_confirm: true, user_metadata: { full_name: account.name, phone: account.phone, role: account.role } })
    : await authSupabase.auth.admin.createUser({ email: account.email, password: secret, email_confirm: true, user_metadata: { full_name: account.name, phone: account.phone, role: account.role } })
  if (authResult.error || !authResult.data.user) throw authResult.error ?? new Error(`Could not create ${account.role}`)
  const userId = authResult.data.user.id
  const profile = await supabase.from('profiles').upsert({ id: userId, full_name: account.name, phone_e164: account.phone, username: `${account.role}.test`, role: account.role }).select('id').single()
  if (profile.error) throw profile.error
  if (account.role === 'vendor') {
    const existingVendor = await supabase.from('vendors').select('id').eq('owner_profile_id', userId).maybeSingle()
    if (existingVendor.error) throw existingVendor.error
    const vendor = existingVendor.data
      ? await supabase.from('vendors').update({ business_name: 'Urban Test Vendor Services', phone_e164: account.phone, service_zone: 'Chennai', verification: 'approved' }).eq('id', existingVendor.data.id).select('id').single()
      : await supabase.from('vendors').insert({ owner_profile_id: userId, business_name: 'Urban Test Vendor Services', phone_e164: account.phone, service_zone: 'Chennai', verification: 'approved' }).select('id').single()
    if (vendor.error) throw vendor.error
  }
  credentials.push(`${account.role}|${account.email}|${secret}`)
}
console.log(credentials.join('\n'))
