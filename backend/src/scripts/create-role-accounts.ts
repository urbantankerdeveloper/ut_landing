import crypto from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isInsideDirectory } from '../lib/databaseGuards.js'
import { authSupabase, supabase } from '../supabase.js'

if (process.env.NODE_ENV !== 'test') throw new Error('create-role-accounts only runs with NODE_ENV=test.')

type Role = 'customer' | 'vendor' | 'dispatcher' | 'admin'
type Account = { role: Role; email: string; name: string; phone: string }

const accounts: Account[] = [
  { role: 'customer', email: 'customer.test@urbantanker.in', name: 'Urban Test Customer', phone: '9000000001' },
  { role: 'vendor', email: 'vendor.test@urbantanker.in', name: 'Urban Test Vendor', phone: '9000000002' },
  { role: 'dispatcher', email: 'dispatcher.test@urbantanker.in', name: 'Urban Test Dispatcher', phone: '9000000003' },
  { role: 'admin', email: 'admin.test@urbantanker.in', name: 'Urban Test Admin', phone: '9000000004' },
]

function password() { return `UT-${crypto.randomBytes(12).toString('base64url')}` }

// Generated passwords go to a 0600 file outside the repository. They are never printed.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const credentialsRoot = process.env.CREDENTIALS_DIR ? resolve(process.env.CREDENTIALS_DIR) : tmpdir()
if (isInsideDirectory(credentialsRoot, repositoryRoot)) throw new Error('CREDENTIALS_DIR must be outside the repository.')
const credentialsDirectory = await mkdtemp(join(credentialsRoot, 'urban-tanker-test-accounts-'))

const listed = await authSupabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listed.error) throw listed.error
const credentials: string[] = []
const summary: string[] = []
for (const account of accounts) {
  const existing = listed.data.users.find((user) => user.email?.toLowerCase() === account.email)
  let userId: string
  if (existing) {
    // Existing accounts keep their password. Only the role is refreshed.
    const updated = await authSupabase.auth.admin.updateUserById(existing.id, { app_metadata: { role: account.role } })
    if (updated.error || !updated.data.user) throw updated.error ?? new Error(`Could not update ${account.role}`)
    userId = existing.id
    summary.push(`${account.role} ${account.email}: existing account, password unchanged`)
  } else {
    const secret = password()
    const created = await authSupabase.auth.admin.createUser({ email: account.email, password: secret, email_confirm: true, app_metadata: { role: account.role }, user_metadata: { full_name: account.name, phone: account.phone } })
    if (created.error || !created.data.user) throw created.error ?? new Error(`Could not create ${account.role}`)
    userId = created.data.user.id
    credentials.push(`${account.role}|${account.email}|${secret}`)
    summary.push(`${account.role} ${account.email}: created`)
  }
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
}

console.log(summary.join('\n'))
if (credentials.length) {
  const credentialsFile = join(credentialsDirectory, 'credentials.txt')
  await writeFile(credentialsFile, `${credentials.join('\n')}\n`, { mode: 0o600, flag: 'wx' })
  console.log(`New credentials written to ${credentialsFile} (mode 0600). Passwords are not printed.`)
} else {
  console.log('No new accounts were created, so no credentials file was written.')
}
