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
if (!apiOrigin) throw new Error('prepare-deploy-config: VITE_API_BASE_URL is not set.')
const realtimeWsOrigin = apiOrigin.replace(/^http/, 'ws')
const supabaseOrigin = supabaseRef ? `https://${supabaseRef}.supabase.co` : ''
const canonicalOrigin = originOf(env.VITE_SITE_ORIGIN) || 'https://www.urbantanker.in'
const indexPath = join(root, 'dist', 'index.html')
const replacements = {
  '<SUPABASE_REF>': supabaseRef,
  '__API_ORIGIN__': apiOrigin,
  '__REALTIME_WS_ORIGIN__': realtimeWsOrigin,
  '__SUPABASE_ORIGIN__': supabaseOrigin,
  '__CANONICAL_ORIGIN__': canonicalOrigin,
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
for (const relativePath of ['index.html', 'robots.txt', 'sitemap.xml']) {
  const path = join(root, 'dist', relativePath)
  let deployText = await readFile(path, 'utf8').catch(() => null)
  if (deployText === null) continue
  for (const [placeholder, value] of Object.entries(replacements)) deployText = deployText.replaceAll(placeholder, value)
  deployText = deployText.replaceAll('https://urbantanker.com', canonicalOrigin)
  deployText = deployText.replaceAll('https://www.urbantanker.in', canonicalOrigin)
  await writeFile(path, deployText)
}
console.log(`prepare-deploy-config: filled dist config (api ${apiOrigin}, realtime ${realtimeWsOrigin}, canonical ${canonicalOrigin}).`)
