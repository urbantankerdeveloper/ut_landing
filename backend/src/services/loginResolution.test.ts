import { describe, expect, it, vi } from 'vitest'
import {
  findProfileByUsername,
  resolveLoginEmail,
  signedInAsCredential,
  signInWithFallback,
  unmatchedLoginEmail,
  type LoginLookups,
  type UsernameProfile,
} from './loginResolution.js'

const session = { access_token: 'access', refresh_token: 'refresh' }

function rpcClient(data: unknown, error: { message: string } | null = null) {
  return { rpc: vi.fn(async () => ({ data, error })) }
}

function lookups(profile: UsernameProfile | null, authEmail: string | null = null) {
  return {
    findProfileByUsername: vi.fn(async () => profile),
    getAuthEmail: vi.fn(async () => authEmail),
  } satisfies LoginLookups
}

describe('resolveLoginEmail', () => {
  it('signs a username in with the stored profile email and never reads the auth user', async () => {
    const deps = lookups({ id: 'user-1', username: 'Alice', email: 'alice@example.com' })
    const resolution = await resolveLoginEmail('alice', deps)
    expect(resolution).toEqual({ email: 'alice@example.com', username: 'Alice', profileId: 'user-1', emailSource: 'profile' })

    const signIn = vi.fn(async (_email: string) => session)
    const result = await signInWithFallback(resolution, signIn, deps.getAuthEmail)
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(signIn).toHaveBeenCalledWith('alice@example.com')
    expect(result).toEqual({ signedIn: session, email: 'alice@example.com', retried: false })
    expect(deps.getAuthEmail).not.toHaveBeenCalled()
  })

  it('reads the auth email when the profile email is null and signs in with it', async () => {
    const deps = lookups({ id: 'user-2', username: 'bob', email: null }, 'Bob@Example.com')
    const resolution = await resolveLoginEmail('bob', deps)
    expect(deps.getAuthEmail).toHaveBeenCalledWith('user-2')
    expect(resolution).toEqual({ email: 'bob@example.com', username: 'bob', profileId: 'user-2', emailSource: 'auth' })

    const signIn = vi.fn(async (_email: string) => session)
    await signInWithFallback(resolution, signIn, deps.getAuthEmail)
    expect(signIn).toHaveBeenCalledWith('bob@example.com')
  })

  it('uses the placeholder address for an unknown username and still runs the sign-in call', async () => {
    const deps = lookups(null)
    const resolution = await resolveLoginEmail('nobody', deps)
    expect(resolution.email).toBe(unmatchedLoginEmail)
    expect(resolution.emailSource).toBe('unmatched')
    expect(deps.getAuthEmail).not.toHaveBeenCalled()

    const signIn = vi.fn(async (_email: string) => null)
    const result = await signInWithFallback(resolution, signIn, deps.getAuthEmail)
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(signIn).toHaveBeenCalledWith(unmatchedLoginEmail)
    expect(result.signedIn).toBeNull()
  })

  it('passes an email credential straight through without any username lookup', async () => {
    const deps = lookups(null)
    const resolution = await resolveLoginEmail('carol@example.com', deps)
    expect(resolution).toEqual({ email: 'carol@example.com', username: 'carol@example.com', profileId: null, emailSource: 'email' })
    expect(deps.findProfileByUsername).not.toHaveBeenCalled()
    expect(deps.getAuthEmail).not.toHaveBeenCalled()

    const signIn = vi.fn(async (_email: string) => session)
    await signInWithFallback(resolution, signIn, deps.getAuthEmail)
    expect(signIn).toHaveBeenCalledWith('carol@example.com')
  })
})

describe('signInWithFallback stale-email fallback', () => {
  it('retries exactly once with the authoritative email when it differs from the stored one', async () => {
    const deps = lookups({ id: 'user-3', username: 'dan', email: 'old@example.com' }, 'new@example.com')
    const resolution = await resolveLoginEmail('dan', deps)
    const signIn = vi.fn(async (email: string) => (email === 'new@example.com' ? session : null))

    const result = await signInWithFallback(resolution, signIn, deps.getAuthEmail)
    expect(signIn.mock.calls.map(([email]) => email)).toEqual(['old@example.com', 'new@example.com'])
    expect(deps.getAuthEmail).toHaveBeenCalledTimes(1)
    expect(deps.getAuthEmail).toHaveBeenCalledWith('user-3')
    expect(result).toEqual({ signedIn: session, email: 'new@example.com', retried: true })
  })

  it('does not retry when the authoritative email matches the stored one', async () => {
    const deps = lookups({ id: 'user-4', username: 'erin', email: 'erin@example.com' }, 'ERIN@example.com')
    const resolution = await resolveLoginEmail('erin', deps)
    const signIn = vi.fn(async (_email: string) => null)

    const result = await signInWithFallback(resolution, signIn, deps.getAuthEmail)
    expect(deps.getAuthEmail).toHaveBeenCalledTimes(1)
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ signedIn: null, email: 'erin@example.com', retried: false })
  })

  it('does not retry when the authoritative email cannot be read', async () => {
    const deps = lookups({ id: 'user-5', username: 'frank', email: 'frank@example.com' }, null)
    const resolution = await resolveLoginEmail('frank', deps)
    const signIn = vi.fn(async (_email: string) => null)

    const result = await signInWithFallback(resolution, signIn, deps.getAuthEmail)
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(result.retried).toBe(false)
    expect(result.signedIn).toBeNull()
  })

  it('does not read the auth email again after a failed sign-in with an auth-sourced address', async () => {
    const deps = lookups({ id: 'user-6', username: 'gina', email: null }, 'gina@example.com')
    const resolution = await resolveLoginEmail('gina', deps)
    const signIn = vi.fn(async (_email: string) => null)

    await signInWithFallback(resolution, signIn, deps.getAuthEmail)
    expect(deps.getAuthEmail).toHaveBeenCalledTimes(1)
    expect(signIn).toHaveBeenCalledTimes(1)
  })

  it('does not read the auth email for an unknown username', async () => {
    const deps = lookups(null)
    const resolution = await resolveLoginEmail('ghost', deps)
    const signIn = vi.fn(async (_email: string) => null)

    await signInWithFallback(resolution, signIn, deps.getAuthEmail)
    expect(deps.getAuthEmail).not.toHaveBeenCalled()
    expect(signIn).toHaveBeenCalledTimes(1)
  })
})

describe('signedInAsCredential', () => {
  it('accepts a username sign-in only when it lands on the account the username names', async () => {
    const resolution = await resolveLoginEmail('hina', lookups({ id: 'user-8', username: 'hina', email: 'hina@example.com' }))
    expect(signedInAsCredential(resolution, 'user-8')).toBe(true)
    expect(signedInAsCredential(resolution, 'user-9')).toBe(false)
  })

  it('refuses a stale stored email that now belongs to another account', async () => {
    const deps = lookups({ id: 'user-10', username: 'ivan', email: 'reassigned@example.com' }, 'reassigned@example.com')
    const resolution = await resolveLoginEmail('ivan', deps)
    // The address resolves to a different auth user, so the session is for someone else.
    const signIn = vi.fn(async (_email: string) => ({ userId: 'user-11' }))
    const { signedIn } = await signInWithFallback(resolution, signIn, deps.getAuthEmail)
    expect(signedIn).not.toBeNull()
    expect(signedInAsCredential(resolution, signedIn!.userId)).toBe(false)
  })

  it('refuses a username sign-in against the placeholder address', async () => {
    const resolution = await resolveLoginEmail('nobody', lookups(null))
    expect(signedInAsCredential(resolution, 'any-user')).toBe(false)
  })

  it('does not restrict an email credential', async () => {
    const resolution = await resolveLoginEmail('carol@example.com', lookups(null))
    expect(signedInAsCredential(resolution, 'any-user')).toBe(true)
  })
})

describe('findProfileByUsername', () => {
  it('calls the RPC with the raw username and never with a LIKE pattern or escaped text', async () => {
    const client = rpcClient([{ id: 'user-7', username: 'a_b%c', email: 'x@example.com' }])
    const result = await findProfileByUsername(client, 'a_b%c')
    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(client.rpc).toHaveBeenCalledWith('find_profile_by_username', { p_username: 'a_b%c' })
    const [, args] = client.rpc.mock.calls[0] as unknown as [string, { p_username: string }]
    expect(args.p_username).not.toContain('\\')
    expect(result).toEqual({ profile: { id: 'user-7', username: 'a_b%c', email: 'x@example.com' }, error: null })
  })

  it('does not match a wildcard username to a different account', async () => {
    const client = rpcClient([])
    const result = await findProfileByUsername(client, '%')
    expect(client.rpc).toHaveBeenCalledWith('find_profile_by_username', { p_username: '%' })
    expect(result).toEqual({ profile: null, error: null })
  })

  it('returns no profile and the error message when the RPC fails', async () => {
    const client = rpcClient(null, { message: 'permission denied' })
    const result = await findProfileByUsername(client, 'alice')
    expect(result).toEqual({ profile: null, error: 'permission denied' })
  })
})
