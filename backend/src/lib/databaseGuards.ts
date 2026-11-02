import { isAbsolute, relative, resolve, sep } from 'node:path'

export function supabaseProjectRef(supabaseUrl: string | undefined) {
  if (!supabaseUrl) return null
  try {
    return new URL(supabaseUrl).hostname.split('.')[0] || null
  } catch {
    return null
  }
}

type ResetEnvironment = {
  NODE_ENV?: string
  SUPABASE_URL?: string
  DB_RESET_ALLOWED_PROJECT_REFS?: string
  CONFIRM_DATABASE_RESET?: string
}

// Returns the reason a database reset must not run, or null when it may run.
export function databaseResetRefusal(environment: ResetEnvironment): string | null {
  if (environment.NODE_ENV !== 'test') return 'Database reset only runs with NODE_ENV=test.'
  const allowedRefs = (environment.DB_RESET_ALLOWED_PROJECT_REFS ?? '').split(',').map((ref) => ref.trim()).filter(Boolean)
  const ref = supabaseProjectRef(environment.SUPABASE_URL)
  if (!ref || !allowedRefs.includes(ref)) return 'The project ref in SUPABASE_URL is not listed in DB_RESET_ALLOWED_PROJECT_REFS.'
  if (environment.CONFIRM_DATABASE_RESET !== 'URBAN_TANKER_RESET') return 'Set CONFIRM_DATABASE_RESET=URBAN_TANKER_RESET explicitly.'
  return null
}

export function isInsideDirectory(target: string, directory: string) {
  const relativePath = relative(resolve(directory), resolve(target))
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}

export function backupDestinationRefusal(backupDirectory: string, repositoryRoot: string): string | null {
  if (isInsideDirectory(backupDirectory, repositoryRoot)) return 'BACKUP_DIR must be outside the repository. Backups in the repo can be committed by mistake.'
  return null
}

export function plaintextBackupRefusal(input: { nodeEnv?: string; ageRecipient?: string; allowPlaintext: boolean }): string | null {
  if (input.ageRecipient || input.nodeEnv !== 'production' || input.allowPlaintext) return null
  return 'Refusing to write an unencrypted backup in production. Set BACKUP_AGE_RECIPIENT, or set ALLOW_PLAINTEXT_BACKUP=true to accept plaintext.'
}
