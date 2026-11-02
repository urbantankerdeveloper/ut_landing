import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backupDestinationRefusal, databaseResetRefusal, plaintextBackupRefusal, supabaseProjectRef } from './databaseGuards.js'

const testEnvironment = {
  NODE_ENV: 'test',
  SUPABASE_URL: 'https://abcdwxyz.supabase.co',
  DB_RESET_ALLOWED_PROJECT_REFS: 'zzzz0000, abcdwxyz',
  CONFIRM_DATABASE_RESET: 'URBAN_TANKER_RESET',
}

describe('databaseResetRefusal', () => {
  it('allows a reset only for an allowed test project with the typed confirmation', () => {
    expect(databaseResetRefusal(testEnvironment)).toBeNull()
  })

  it('refuses outside NODE_ENV=test', () => {
    expect(databaseResetRefusal({ ...testEnvironment, NODE_ENV: 'development' })).toContain('NODE_ENV=test')
    expect(databaseResetRefusal({ ...testEnvironment, NODE_ENV: undefined })).toContain('NODE_ENV=test')
  })

  it('refuses a project ref that is not in the allow list', () => {
    expect(databaseResetRefusal({ ...testEnvironment, DB_RESET_ALLOWED_PROJECT_REFS: '' })).toContain('DB_RESET_ALLOWED_PROJECT_REFS')
    expect(databaseResetRefusal({ ...testEnvironment, SUPABASE_URL: 'https://otherref.supabase.co' })).toContain('DB_RESET_ALLOWED_PROJECT_REFS')
  })

  it('still requires the typed confirmation token', () => {
    expect(databaseResetRefusal({ ...testEnvironment, CONFIRM_DATABASE_RESET: undefined })).toContain('CONFIRM_DATABASE_RESET')
  })
})

describe('supabaseProjectRef', () => {
  it('reads the project ref from the Supabase URL', () => {
    expect(supabaseProjectRef('https://abcdwxyz.supabase.co')).toBe('abcdwxyz')
    expect(supabaseProjectRef('not a url')).toBeNull()
  })
})

describe('backupDestinationRefusal', () => {
  const repository = resolve('/work/ut_landing')

  it('refuses a backup directory inside the repository', () => {
    expect(backupDestinationRefusal(resolve('/work/ut_landing/backend/backups'), repository)).not.toBeNull()
  })

  it('accepts a directory outside the repository, including similar prefixes', () => {
    expect(backupDestinationRefusal(resolve('/work/backups'), repository)).toBeNull()
    expect(backupDestinationRefusal(resolve('/work/ut_landing_backups'), repository)).toBeNull()
  })
})

describe('plaintextBackupRefusal', () => {
  it('refuses plaintext in production unless explicitly allowed', () => {
    expect(plaintextBackupRefusal({ nodeEnv: 'production', allowPlaintext: false })).not.toBeNull()
    expect(plaintextBackupRefusal({ nodeEnv: 'production', allowPlaintext: true })).toBeNull()
  })

  it('allows encrypted backups in production and plaintext elsewhere', () => {
    expect(plaintextBackupRefusal({ nodeEnv: 'production', ageRecipient: 'age1example', allowPlaintext: false })).toBeNull()
    expect(plaintextBackupRefusal({ nodeEnv: 'development', allowPlaintext: false })).toBeNull()
  })
})
