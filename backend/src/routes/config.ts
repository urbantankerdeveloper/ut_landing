import { Router } from 'express'
import { config } from '../config.js'

const router = Router()

router.get('/flags', (_request, response) => {
  response.setHeader('Cache-Control', 'private, max-age=60')
  response.json(config.featureFlags)
})

export default router
