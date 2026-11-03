// Stops the local benchmark stack started by start.mjs. Usage (from backend/): node scripts/bench/local-stack/stop.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pidFile = resolve(here, '.stack/pids.json')
if (!existsSync(pidFile)) {
  console.log('No running stack recorded.')
  process.exit(0)
}
const pids = JSON.parse(readFileSync(pidFile, 'utf8'))
// Also stop anything still listening on the stack ports, so a process whose PID was never recorded is not left running.
for (const port of [55432, 3001, 54321]) {
  try {
    const owner = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess`], { encoding: 'utf8' }).trim()
    if (owner) pids[`port-${port}`] = Number(owner)
  } catch {
    // Nothing is listening on this port.
  }
}
for (const [name, pid] of Object.entries(pids)) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    console.log(`stopped ${name} (${pid})`)
  } catch {
    console.log(`${name} (${pid}) was not running`)
  }
}
rmSync(pidFile)
