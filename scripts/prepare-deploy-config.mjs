import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

// Fills the deploy-time placeholders in dist/.htaccess (Apache, Hostinger) and fails the build when a placeholder is left behind,
// so a policy with a missing origin never ships.
const root = fileURLToPath(new URL('../', import.meta.url))
const htaccessPath = join(root, 'dist', '.htaccess')
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

let text = await readFile(htaccessPath, 'utf8').catch(() => {
  throw new Error('prepare-deploy-config: dist/.htaccess not found. Run vite build first.')
})
for (const [placeholder, value] of Object.entries(replacements)) text = text.replaceAll(placeholder, value)

const leftovers = Object.keys(replacements).filter((placeholder) => text.includes(placeholder))
if (leftovers.length > 0) {
  console.error(`prepare-deploy-config: placeholders are still present in dist/.htaccess: ${leftovers.join(', ')}`)
  process.exit(1)
}

await writeFile(htaccessPath, text)
console.log(`prepare-deploy-config: filled dist/.htaccess (api ${apiOrigin || 'same-origin'}, realtime ${realtimeWsOrigin || 'same-origin'}).`)
