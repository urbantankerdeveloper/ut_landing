import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDirectory = resolve(backendDirectory, 'dist')
const archivePath = resolve(backendDirectory, 'hostinger-upload.zip')
const packageJsonPath = resolve(backendDirectory, 'package.json')
const packageLockPath = resolve(backendDirectory, 'package-lock.json')

const buildCommand = process.platform === 'win32' ? 'npm.cmd run build' : 'npm run build'
execSync(buildCommand, { cwd: backendDirectory, stdio: 'inherit' })

if (!existsSync(packageLockPath)) throw new Error('package-lock.json is required to build the Hostinger upload.')
if (!existsSync(join(distDirectory, 'server.js'))) throw new Error('Build did not produce dist/server.js.')

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const packageLock = JSON.parse(readFileSync(packageLockPath, 'utf8'))
if (!packageJson.dependencies?.express) throw new Error('Express must be a direct dependency in package.json.')
if (packageLock.packages?.['']?.dependencies?.express !== packageJson.dependencies.express) {
  throw new Error('package-lock.json is out of sync with the direct Express dependency.')
}

const excludedDirectories = new Set(['.git', 'node_modules', 'test', 'tests', '__tests__', 'coverage'])
function shouldIncludeDistPath(sourcePath) {
  const pathFromDist = relative(distDirectory, sourcePath)
  if (!pathFromDist) return true
  const segments = pathFromDist.split(sep)
  const baseName = segments.at(-1) ?? ''
  if (segments.some((segment) => excludedDirectories.has(segment.toLowerCase()))) return false
  if (/^\.env(?:$|\.)/i.test(baseName)) return false
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(baseName)) return false
  return true
}

function assertNoExcludedFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (excludedDirectories.has(entry.name.toLowerCase()) || /^\.env(?:$|\.)/i.test(entry.name)) {
      throw new Error(`Excluded content found in package staging directory: ${entry.name}`)
    }
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(entry.name)) {
      throw new Error(`Test file found in package staging directory: ${entry.name}`)
    }
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) assertNoExcludedFiles(entryPath)
    else if (!entry.isFile()) throw new Error(`Unsupported package entry: ${entryPath}`)
  }
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'urban-tanker-hostinger-'))
const stageDirectory = join(temporaryDirectory, 'package')
const temporaryArchivePath = join(temporaryDirectory, 'hostinger-upload.zip')

try {
  mkdirSync(stageDirectory)
  const hostingerPackageJson = {
    ...packageJson,
    scripts: {
      ...packageJson.scripts,
      build: "node -e \"require('node:fs').accessSync('dist/server.js')\"",
    },
  }
  writeFileSync(join(stageDirectory, 'package.json'), `${JSON.stringify(hostingerPackageJson, null, 2)}\n`)
  copyFileSync(packageLockPath, join(stageDirectory, 'package-lock.json'))
  writeFileSync(join(stageDirectory, '.npmrc'), 'omit=dev\n')
  cpSync(distDirectory, join(stageDirectory, 'dist'), { recursive: true, filter: shouldIncludeDistPath })
  writeFileSync(join(stageDirectory, 'dist', 'server.cjs'), [
    "import('./server.js').catch((error) => {",
    "  console.error('Backend startup failed:', error)",
    '  process.exit(1)',
    '})',
    '',
  ].join('\n'))
  assertNoExcludedFiles(stageDirectory)

  if (process.platform === 'win32') {
    const powershellCommand = [
      '$ErrorActionPreference = "Stop"',
      'Add-Type -AssemblyName System.IO.Compression',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      '$archive = [System.IO.Compression.ZipFile]::Open($env:HOSTINGER_ARCHIVE, [System.IO.Compression.ZipArchiveMode]::Create)',
      'try {',
      '  Get-ChildItem -LiteralPath $env:HOSTINGER_STAGE_DIR -File -Recurse | ForEach-Object {',
      '    $entryName = $_.FullName.Substring($env:HOSTINGER_STAGE_DIR.Length + 1).Replace([char]92, [char]47)',
      '    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal)',
      '  }',
      '} finally { $archive.Dispose() }',
    ].join('; ')
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', powershellCommand], {
      cwd: backendDirectory,
      env: {
        ...process.env,
        HOSTINGER_STAGE_DIR: stageDirectory,
        HOSTINGER_ARCHIVE: temporaryArchivePath,
      },
      stdio: 'inherit',
    })
  } else {
    execFileSync('zip', ['-q', '-r', temporaryArchivePath, 'package.json', 'package-lock.json', 'dist'], {
      cwd: stageDirectory,
      stdio: 'inherit',
    })
  }

  if (!existsSync(temporaryArchivePath) || statSync(temporaryArchivePath).size === 0) {
    throw new Error('ZIP creation did not produce a valid, non-empty archive.')
  }
  copyFileSync(temporaryArchivePath, archivePath)
  console.log(`Hostinger package created: ${archivePath}`)
  console.log('Archive root: package.json, package-lock.json, dist/')
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}
