import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const assetsDir = fileURLToPath(new URL('../dist/assets/', import.meta.url))
const deployDir = fileURLToPath(new URL('../dist/', import.meta.url))
const forbidden = [
  { label: 'React DevTools banner (development build)', pattern: /Download the React DevTools/ },
  { label: 'absolute Windows path (D:/...)', pattern: /(?<![A-Za-z0-9])[A-Za-z]:\/(?!\/)[\w.~-]+\// },
]

const files = (await readdir(assetsDir).catch(() => [])).filter((name) => name.endsWith('.js'))
if (files.length === 0) {
  console.error(`verify-bundle: no JavaScript assets found in ${assetsDir}. Run the build first.`)
  process.exit(1)
}

const failures = []
for (const name of files) {
  const source = await readFile(join(assetsDir, name), 'utf8')
  for (const { label, pattern } of forbidden) {
    const match = source.match(pattern)
    if (match) failures.push(`${name}: ${label} -> ${match[0]}`)
  }
}

const htaccess = await readFile(join(deployDir, '.htaccess'), 'utf8').catch(() => '')
if (!htaccess) {
  failures.push('dist/.htaccess is missing.')
} else {
  const requiredMimeMappings = [
    ['JavaScript', /AddType\s+text\/javascript\s+\.js\b/],
    ['CSS', /AddType\s+text\/css\s+\.css\b/],
    ['JSON', /AddType\s+application\/json\s+\.json\b/],
    ['web manifest', /AddType\s+application\/manifest\+json\s+\.webmanifest\b/],
    ['precompressed JavaScript', /ForceType\s+text\/javascript/],
    ['precompressed CSS', /ForceType\s+text\/css/],
  ]
  for (const [label, pattern] of requiredMimeMappings) {
    if (!pattern.test(htaccess)) failures.push(`dist/.htaccess is missing the ${label} MIME mapping.`)
  }
}

const manifest = await readFile(join(deployDir, 'manifest.json'), 'utf8').catch(() => '')
if (!manifest) {
  failures.push('dist/manifest.json is missing.')
} else {
  try {
    JSON.parse(manifest)
  } catch {
    failures.push('dist/manifest.json is not valid JSON.')
  }
}

if (failures.length > 0) {
  console.error('verify-bundle: production deployment checks failed:')
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log(`verify-bundle: ${files.length} JavaScript assets are production-clean.`)
