import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const assetsDir = fileURLToPath(new URL('../dist/assets/', import.meta.url))
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

if (failures.length > 0) {
  console.error('verify-bundle: production bundle contains development artifacts:')
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log(`verify-bundle: ${files.length} JavaScript assets are production-clean.`)
