// Decision logic for POST /login. Supabase lookups are passed in as parameters, so these functions run without a database.

export const unmatchedLoginEmail = 'no-account@login.urbantanker.local'

export type UsernameProfile = { id: string; username: string | null; email: string | null }

// Structural subset of the supabase-js client, so the service client can be passed in directly.
export type RpcClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

function normalizeEmail(value: string | null | undefined) {
  const trimmed = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return trimmed || null
}

// Calls the find_profile_by_username RPC. The SQL side compares lower(username) = lower(p_username), so the raw
// username goes in unchanged. It must never be escaped or wrapped in a pattern. The RPC returns at most one row.
export async function findProfileByUsername(client: RpcClient, username: string): Promise<{ profile: UsernameProfile | null; error: string | null }> {
  const { data, error } = await client.rpc('find_profile_by_username', { p_username: username })
  if (error) return { profile: null, error: error.message }
  const row = Array.isArray(data) ? (data[0] as UsernameProfile | undefined) : undefined
  return { profile: row ?? null, error: null }
}

export type LoginLookups = {
  findProfileByUsername: (username: string) => Promise<UsernameProfile | null>
  getAuthEmail: (profileId: string) => Promise<string | null>
}

export type LoginResolution = {
  // The address to try first.
  email: string
  // The username returned to the client.
  username: string
  // Set when the address belongs to a known account. Used for the stale-email fallback and for an early profile read.
  profileId: string | null
  emailSource: 'email' | 'profile' | 'auth' | 'unmatched'
}

// An email credential goes straight through. A username uses the email stored on the profile. If that is null,
// the auth email is read instead. An unknown username gets the placeholder address, so the sign-in call still runs.
export async function resolveLoginEmail(credential: string, lookups: LoginLookups): Promise<LoginResolution> {
  if (credential.includes('@')) return { email: credential, username: credential, profileId: null, emailSource: 'email' }
  const profile = await lookups.findProfileByUsername(credential)
  if (!profile) return { email: unmatchedLoginEmail, username: credential, profileId: null, emailSource: 'unmatched' }
  const username = profile.username ?? credential
  const storedEmail = normalizeEmail(profile.email)
  if (storedEmail) return { email: storedEmail, username, profileId: profile.id, emailSource: 'profile' }
  const authEmail = normalizeEmail(await lookups.getAuthEmail(profile.id))
  if (authEmail) return { email: authEmail, username, profileId: profile.id, emailSource: 'auth' }
  return { email: unmatchedLoginEmail, username, profileId: null, emailSource: 'unmatched' }
}

// A username must sign in as the account it names. A stored email that now belongs to another account
// (reassigned in the dashboard) must not hand that other account's session to this username.
export function signedInAsCredential(resolution: LoginResolution, signedInUserId: string) {
  if (resolution.emailSource === 'email') return true
  return resolution.profileId !== null && resolution.profileId === signedInUserId
}

// Signs in with the resolved address. If that fails and the address came from profiles.email, which can be stale
// (for example after an email change in the Supabase dashboard), the authoritative auth email is read once. The
// sign-in is retried only when that address differs. The retry result is final.
export async function signInWithFallback<T>(
  resolution: LoginResolution,
  signIn: (email: string) => Promise<T | null>,
  getAuthEmail: (profileId: string) => Promise<string | null>,
): Promise<{ signedIn: T | null; email: string; retried: boolean }> {
  const first = await signIn(resolution.email)
  if (first || resolution.emailSource !== 'profile' || !resolution.profileId) return { signedIn: first, email: resolution.email, retried: false }
  const authEmail = normalizeEmail(await getAuthEmail(resolution.profileId))
  if (!authEmail || authEmail === resolution.email) return { signedIn: null, email: resolution.email, retried: false }
  const second = await signIn(authEmail)
  return { signedIn: second, email: authEmail, retried: true }
}
