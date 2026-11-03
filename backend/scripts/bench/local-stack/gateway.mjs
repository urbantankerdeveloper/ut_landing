// Local gateway for benchmarking. One origin serves both halves of the Supabase client:
//   /rest/v1/*  -> PostgREST (proxied)
//   /auth/v1/*  -> a minimal Auth stand-in: password sign-in, user lookup, JWKS, sign-out
// It issues real ES256 access tokens and publishes the matching JWKS, so the backend's local token check runs for real.
// It is NOT Supabase Auth. It adds no artificial latency, so auth timings reflect only local work.
import http from 'node:http'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SignJWT, jwtVerify, exportJWK, generateKeyPair, importJWK } from 'jose'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const stackDir = resolve(here, '.stack')
const port = Number(process.env.GATEWAY_PORT ?? 54321)
const postgrestUrl = new URL(process.env.POSTGREST_URL ?? 'http://127.0.0.1:3001')
const databaseUrl = process.env.BENCH_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55432/urban_bench'
const benchPassword = process.env.BENCH_PASSWORD ?? 'bench-pass-123'
const issuer = `http://127.0.0.1:${port}/auth/v1`

async function loadKeys() {
  const file = resolve(stackDir, 'auth-keys.json')
  if (existsSync(file)) {
    const { privateJwk, publicJwk } = JSON.parse(await fs.readFile(file, 'utf8'))
    return { privateKey: await importJWK(privateJwk, 'ES256'), publicJwk }
  }
  const pair = await generateKeyPair('ES256', { extractable: true })
  const privateJwk = { ...(await exportJWK(pair.privateKey)), kid: 'bench-key', alg: 'ES256', use: 'sig' }
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'bench-key', alg: 'ES256', use: 'sig' }
  await fs.mkdir(stackDir, { recursive: true })
  await fs.writeFile(file, JSON.stringify({ privateJwk, publicJwk }))
  return { privateKey: pair.privateKey, publicJwk }
}

const { privateKey, publicJwk } = await loadKeys()
const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 })

function userResponse(row) {
  return {
    id: row.id,
    aud: row.aud,
    role: row.role,
    email: row.email,
    phone: row.phone ?? '',
    email_confirmed_at: row.email_confirmed_at,
    app_metadata: row.raw_app_meta_data ?? {},
    user_metadata: row.raw_user_meta_data ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function issueSession(row) {
  const now = Math.floor(Date.now() / 1000)
  const sessionId = crypto.randomUUID()
  const accessToken = await new SignJWT({
    email: row.email,
    phone: row.phone ?? '',
    role: 'authenticated',
    aud: 'authenticated',
    session_id: sessionId,
    amr: [{ method: 'password', timestamp: now }],
    app_metadata: row.raw_app_meta_data ?? {},
    user_metadata: row.raw_user_meta_data ?? {},
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'bench-key' })
    .setSubject(row.id)
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey)
  return { access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: crypto.randomUUID(), user: userResponse(row) }
}

function json(response, status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
  response.end(payload)
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function authenticate(request) {
  const header = request.headers.authorization ?? ''
  const token = header.replace(/^Bearer\s+/i, '')
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, await importJWK(publicJwk, 'ES256'), { issuer, audience: 'authenticated', algorithms: ['ES256'] })
    return payload
  } catch {
    return null
  }
}

async function handleAuth(request, response, url) {
  const path = url.pathname.replace(/^\/auth\/v1/, '')
  if (request.method === 'GET' && path === '/.well-known/jwks.json') return json(response, 200, { keys: [publicJwk] })

  if (request.method === 'POST' && path === '/token' && url.searchParams.get('grant_type') === 'password') {
    const body = JSON.parse(await readBody(request) || '{}')
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null
    if (!email || typeof body.password !== 'string') return json(response, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
    const { rows } = await pool.query('select * from auth.users where lower(email) = $1 limit 1', [email])
    const row = rows[0]
    if (!row || row.encrypted_password !== `bench:${benchPassword}` || body.password !== benchPassword) {
      return json(response, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
    }
    return json(response, 200, await issueSession(row))
  }

  if (request.method === 'GET' && path === '/user') {
    const claims = await authenticate(request)
    if (!claims) return json(response, 401, { error: 'invalid_token', message: 'invalid JWT' })
    const { rows } = await pool.query('select * from auth.users where id = $1', [claims.sub])
    if (!rows[0]) return json(response, 403, { error: 'user_not_found' })
    return json(response, 200, userResponse(rows[0]))
  }

  if (request.method === 'GET' && path.startsWith('/admin/users/')) {
    const id = decodeURIComponent(path.slice('/admin/users/'.length))
    const { rows } = await pool.query('select * from auth.users where id = $1', [id]).catch(() => ({ rows: [] }))
    if (!rows[0]) return json(response, 404, { error: 'user_not_found' })
    return json(response, 200, userResponse(rows[0]))
  }

  if (request.method === 'POST' && path === '/logout') {
    response.writeHead(204)
    return response.end()
  }

  return json(response, 404, { error: 'not_found', message: `Unsupported local auth route: ${request.method} ${path}` })
}

function proxyToPostgrest(request, response, url) {
  const target = new URL(url.pathname.replace(/^\/rest\/v1/, '') + url.search, postgrestUrl)
  const upstream = http.request(target, { method: request.method, headers: { ...request.headers, host: postgrestUrl.host } }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
    upstreamResponse.pipe(response)
  })
  upstream.on('error', (error) => {
    json(response, 502, { error: 'postgrest_unreachable', message: error.message })
  })
  request.pipe(upstream)
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  try {
    if (url.pathname.startsWith('/rest/v1')) return proxyToPostgrest(request, response, url)
    if (url.pathname.startsWith('/auth/v1')) return await handleAuth(request, response, url)
    return json(response, 404, { error: 'not_found' })
  } catch (error) {
    if (!response.headersSent) json(response, 500, { error: 'gateway_error', message: error instanceof Error ? error.message : String(error) })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'gateway.listening', port, issuer }))
})
