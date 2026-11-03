#!/usr/bin/env node
// Runs the API benchmark scenarios with autocannon and writes JSON + Markdown results.
//
// Usage (local or staging only, never production):
//   BENCH_BASE_URL=http://127.0.0.1:4000 node scripts/bench/run.mjs --only=customer-orders,admin-orders
//
// Env:
//   BENCH_BASE_URL       required, e.g. http://127.0.0.1:4000
//   BENCH_LABEL          result file prefix, default "run" (use "baseline" for the Phase 0 run)
//   BENCH_CONNECTIONS    concurrent connections, default 10
//   BENCH_DURATION       seconds per scenario, default 20
//   BENCH_ALLOW_REMOTE   must be "true" to benchmark a non-local host (staging with seeded data only)
//   BENCH_CUSTOMER_EMAIL / BENCH_CUSTOMER_PASSWORD / BENCH_CUSTOMER_USERNAME
//   BENCH_VENDOR_EMAIL / BENCH_VENDOR_PASSWORD
//   BENCH_ADMIN_EMAIL / BENCH_ADMIN_PASSWORD
//   BENCH_QUOTE_BODY     JSON body for customer-quote-preview (scenario is skipped when unset)
//
// Credentials and tokens are read from the environment and are never printed.

import autocannon from 'autocannon'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCENARIOS } from './scenarios.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const env = process.env
const baseUrl = env.BENCH_BASE_URL
const label = env.BENCH_LABEL || 'run'
const connections = Number(env.BENCH_CONNECTIONS || 10)
const duration = Number(env.BENCH_DURATION || 20)
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length).split(',')

if (!baseUrl) {
  console.error('BENCH_BASE_URL is required, for example http://127.0.0.1:4000')
  process.exit(1)
}

const target = new URL(baseUrl)
const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname)
if (!isLocal && env.BENCH_ALLOW_REMOTE !== 'true') {
  console.error('Refusing to benchmark a non-local host. Set BENCH_ALLOW_REMOTE=true only for a staging instance with seeded data.')
  process.exit(1)
}

const ROLE_CREDENTIALS = {
  customer: ['BENCH_CUSTOMER_EMAIL', 'BENCH_CUSTOMER_PASSWORD'],
  vendor: ['BENCH_VENDOR_EMAIL', 'BENCH_VENDOR_PASSWORD'],
  admin: ['BENCH_ADMIN_EMAIL', 'BENCH_ADMIN_PASSWORD'],
}

// Logs in once per role. Errors name the role only, never the email or password.
async function loginRole(role) {
  const [emailKey, passwordKey] = ROLE_CREDENTIALS[role]
  const response = await fetch(new URL('/api/auth/login', target), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-platform': 'mobile' },
    body: JSON.stringify({ email: env[emailKey], password: env[passwordKey] }),
  })
  if (!response.ok) throw new Error(`login for ${role} failed with HTTP ${response.status}`)
  const body = await response.json()
  if (!body.accessToken) throw new Error(`login for ${role} returned no accessToken`)
  return body.accessToken
}

function missingInputs(scenario) {
  const missing = scenario.needs.filter((key) => !env[key])
  if (scenario.role && ROLE_CREDENTIALS[scenario.role].some((key) => !env[key])) missing.push(`${scenario.role} credentials`)
  return missing
}

function summarise(scenario, request, result) {
  const total = result.requests.total || 1
  const failed = result.non2xx + result.errors + result.timeouts
  return {
    name: scenario.name,
    method: request.method,
    path: request.path.split('?')[0],
    connections,
    durationSeconds: duration,
    requests: result.requests.total,
    rps: Math.round(result.requests.average),
    avgMs: round(result.latency.average),
    p50Ms: round(result.latency.p50),
    p97_5Ms: round(result.latency.p97_5),
    p99Ms: round(result.latency.p99),
    non2xx: result.non2xx,
    socketErrors: result.errors,
    timeouts: result.timeouts,
    errorRatePct: round((failed / total) * 100),
    bytesPerResponse: Math.round((result.throughput.total ?? 0) / total),
  }
}

function round(value) {
  return typeof value === 'number' ? Math.round(value * 100) / 100 : null
}

function toMarkdown(rows, skipped) {
  const header = '| Scenario | Method | Path | RPS | avg ms | p50 ms | p97.5 ms | p99 ms | Non-2xx | Socket err | Timeouts | Error % | Bytes/resp |'
  const divider = '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
  const lines = rows.map((row) =>
    `| ${row.name} | ${row.method} | \`${row.path}\` | ${row.rps} | ${row.avgMs} | ${row.p50Ms} | ${row.p97_5Ms} | ${row.p99Ms} | ${row.non2xx} | ${row.socketErrors} | ${row.timeouts} | ${row.errorRatePct} | ${row.bytesPerResponse} |`,
  )
  const skippedLines = skipped.map((item) => `- Skipped \`${item.name}\`: missing ${item.missing.join(', ')}`)
  return [header, divider, ...lines, ...(skippedLines.length ? ['', ...skippedLines] : [])].join('\n')
}

const selected = SCENARIOS.filter((scenario) => !only || only.includes(scenario.name))
const tokens = {}
const rows = []
const skipped = []

for (const role of Object.keys(ROLE_CREDENTIALS)) {
  if (!selected.some((scenario) => scenario.role === role && missingInputs(scenario).length === 0)) continue
  tokens[role] = await loginRole(role)
}

for (const scenario of selected) {
  const missing = missingInputs(scenario)
  if (missing.length) {
    skipped.push({ name: scenario.name, missing })
    continue
  }
  const request = scenario.request(env, tokens[scenario.role])
  const url = new URL(request.path, target).toString()
  console.error(`Running ${scenario.name} (${request.method} ${request.path.split('?')[0]}) for ${duration}s with ${connections} connections`)
  const result = await autocannon({
    url,
    method: request.method,
    headers: request.headers,
    body: request.body,
    connections,
    duration,
  })
  rows.push(summarise(scenario, request, result))
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outDir = resolve(here, 'results')
await mkdir(outDir, { recursive: true })
const payload = { label, startedAt: stamp, baseHost: target.host, connections, durationSeconds: duration, rows, skipped }
await writeFile(resolve(outDir, `${label}-${stamp}.json`), JSON.stringify(payload, null, 2))

console.log(toMarkdown(rows, skipped))
console.error(`Wrote ${resolve(outDir, `${label}-${stamp}.json`)}`)
