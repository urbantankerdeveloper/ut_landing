import { readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

// Fills the deploy-time placeholders in the copied header files (.htaccess for Apache, _headers for Netlify/Cloudflare)
// and fails the build when a placeholder is left behind, so a policy with a missing origin never ships.
const root = fileURLToPath(new URL('../', import.meta.url))
const distDir = join(root, 'dist')
const env = loadEnv('production', root, '')

function originOf(url) {
  return url ? new URL(url).origin : ''
}

const supabaseRef = env.SUPABASE_REF?.trim()
if (!supabaseRef) throw new Error('prepare-deploy-config: SUPABASE_REF is not set. Set it to the Supabase project reference (the subdomain of <ref>.supabase.co).')

const apiOrigin = originOf(env.VITE_API_BASE_URL)
const realtimeWsOrigin = originOf(env.VITE_REALTIME_URL).replace(/^http/, 'ws')
const replacements = {
  '<SUPABASE_REF>': supabaseRef,
  '__API_ORIGIN__': apiOrigin,
  '__REALTIME_WS_ORIGIN__': realtimeWsOrigin,
}

const headerFiles = ['.htaccess', '_headers']
const present = []
for (const name of headerFiles) {
  const path = join(distDir, name)
  try {
    await access(path)
    present.push(path)
  } catch { /* this host may use only one of the header files */ }
}
if (present.length === 0) throw new Error('prepare-deploy-config: no .htaccess or _headers file found in dist/.')

const leftovers = []
for (const path of present) {
  let text = await readFile(path, 'utf8')
  for (const [placeholder, value] of Object.entries(replacements)) text = text.replaceAll(placeholder, value)
  for (const placeholder of ['<SUPABASE_REF>', '__API_ORIGIN__', '__REALTIME_WS_ORIGIN__']) {
    if (text.includes(placeholder)) leftovers.push(`${path}: ${placeholder}`)
  }
  await writeFile(path, text)
}

if (leftovers.length > 0) {
  console.error('prepare-deploy-config: placeholders are still present:')
  for (const leftover of leftovers) console.error(`  ${leftover}`)
  process.exit(1)
}

console.log(`prepare-deploy-config: filled ${present.map((path) => path.split(/[\/]/).pop()).join(', ')} (api ${apiOrigin || 'same-origin'}, realtime ${realtimeWsOrigin || 'same-origin'}).`)
