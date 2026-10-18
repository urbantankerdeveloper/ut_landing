import { createServer } from 'node:http'
import { existsSync, promises as fs } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'public_html')
const port = 4174
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
}

async function listPages(directory = root, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const pages = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    const urlPath = `${prefix}/${entry.name}`
    if (entry.isDirectory()) pages.push(...await listPages(path, urlPath))
    else if (entry.name.endsWith('.html')) pages.push(urlPath)
  }
  return pages
}

if (process.argv.includes('--list')) {
  if (!existsSync(root)) throw new Error(`Reference directory not found: ${root}`)
  for (const page of (await listPages()).sort()) console.log(page)
  process.exit(0)
}

const server = createServer(async (request, response) => {
  try {
    const requestPath = decodeURIComponent(new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname)
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '')
    const filePath = normalize(join(root, relativePath))
    const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`
    if (filePath !== root && !filePath.startsWith(rootWithSeparator)) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Forbidden')
      return
    }
    const stats = await fs.stat(filePath)
    if (!stats.isFile()) throw new Error('Not a file')
    response.writeHead(200, { 'cache-control': 'no-cache', 'content-type': mimeTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream' })
    response.end(await fs.readFile(filePath))
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Reference page or asset not found')
  }
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Reference site could not start: port ${port} is already in use.`)
    process.exitCode = 1
    return
  }
  throw error
})

server.listen(port, '127.0.0.1', () => {
  console.log(`HTML reference site: http://localhost:${port}/`)
  console.log('List pages with: npm run reference:list')
})
