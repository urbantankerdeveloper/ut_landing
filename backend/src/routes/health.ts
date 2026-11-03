import { Router } from 'express'
import { checkDatabaseConnection } from '../database.js'
import { getRedisPair } from '../services/scaling.js'

// /health is liveness. /health/ready is readiness: 503 when the database check fails, including when it throws.
// Redis is reported but does not fail readiness, because the API keeps serving (with per-instance limits) without it.
export function createHealthRouter({ redisConfigured, checkDatabase = checkDatabaseConnection }: { redisConfigured: boolean; checkDatabase?: () => Promise<boolean> }) {
  const router = Router()
  router.get('/health', (_request, response) => response.json({ ok: true, service: 'urban-tanker-api' }))
  router.get('/health/ready', async (_request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    let databaseReady = false
    try {
      databaseReady = await checkDatabase()
    } catch (error) {
      console.error(JSON.stringify({ event: 'health.database_check_failed', error: error instanceof Error ? error.message : String(error) }))
    }
    const pair = getRedisPair()
    const redis = !redisConfigured ? 'not_configured' : pair?.pub.isReady ? 'ready' : 'unavailable'
    response.status(databaseReady ? 200 : 503).json({ ok: databaseReady, service: 'urban-tanker-api', database: databaseReady ? 'ready' : 'unavailable', redis })
  })
  return router
}
