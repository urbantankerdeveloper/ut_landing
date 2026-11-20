import { Router } from 'express'
import { config } from '../config.js'
import { databaseFailure } from '../lib/httpErrors.js'
import { getManualAssignmentModeEnabled } from '../services/manualAssignmentMode.js'

const router = Router()

router.get('/flags', async (_request, response) => {
  response.setHeader('Cache-Control', 'private, max-age=60')
  try {
    response.json({
      ...config.featureFlags,
      manual_assignment_mode_enabled: await getManualAssignmentModeEnabled(),
      multi_service_orders_enabled: config.MULTI_SERVICE_ORDERS_ENABLED,
    })
  } catch (error) {
    databaseFailure(response, 'config.feature_flags_lookup_failed', error, 500)
  }
})

export default router
