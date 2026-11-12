import express from 'express'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import compression from 'compression'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { createServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { config } from './config.js'
import { logger } from './lib/logger.js'
import { startupBanner } from './lib/startupBanner.js'
import { isAllowedCorsOrigin } from './lib/corsOrigins.js'
import authRoutes from './routes/auth.js'
import customerRoutes from './routes/customer.js'
import vendorRoutes from './routes/vendor.js'
import adminRoutes from './routes/admin.js'
import customerExtendedRoutes from './routes/customerExtended.js'
import vendorExtendedRoutes from './routes/vendorExtended.js'
import adminExtendedRoutes from './routes/adminExtended.js'
import adminSmsTemplateRoutes from './routes/adminSmsTemplates.js'
import paymentRoutes from './routes/payments.js'
import uploadRoutes from './routes/uploads.js'
import supportRoutes from './routes/support.js'
import analyticsRoutes from './routes/analytics.js'
import partnerRoutes from './routes/partner.js'
import deviceRoutes from './routes/devices.js'
import publicTrackingRoutes from './routes/publicTracking.js'
import { errorHandler } from './middleware/errors.js'
import { startBackgroundJobs } from './services/jobs.js'
import { supabase } from './supabase.js'
import { setRealtimeServer } from './services/realtime.js'
import { closeRedisPair, createRedisPair, rateLimitStoreFor, socketAdapterFor, warnIfSingleInstanceInProduction } from './services/scaling.js'
import { requestObservability } from './middleware/observability.js'
import { createHealthRouter } from './routes/health.js'
const redis = await createRedisPair()
const app = express(); const httpServer = createServer(app)
// Keep-alive above the load balancer's idle timeout avoids reused-connection resets. The request timeout bounds slow clients.
httpServer.keepAliveTimeout = config.HTTP_KEEP_ALIVE_TIMEOUT_MS
httpServer.headersTimeout = config.HTTP_HEADERS_TIMEOUT_MS
httpServer.requestTimeout = config.HTTP_REQUEST_TIMEOUT_MS
const frontendDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist')
// The frontend is deployed to Hostinger, so on Render there is no build here. Serve it only when one is present.
const serveFrontend = existsSync(resolve(frontendDist, 'index.html'))
const allowedOrigins = [config.FRONTEND_ORIGIN, ...config.CORS_ORIGINS]
const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (error: Error | null, allowed?: boolean) => void,
  ) => {
    callback(null, isAllowedCorsOrigin(origin, allowedOrigins, config.NODE_ENV))
  },
  credentials: true,
}
app.set('trust proxy', 1)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://*.razorpay.com'],
      connectSrc: ["'self'", 'https://nominatim.openstreetmap.org', 'https://*.razorpay.com'],
      frameSrc: ['https://*.razorpay.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
})); app.use(cors(corsOptions)); app.use(compression()); app.use(rateLimit({ windowMs: 60_000, limit: 120, store: rateLimitStoreFor(redis), passOnStoreError: true, skip: (request) => request.path === '/health' || request.path === '/health/ready' || (request.method === 'GET' && !request.path.startsWith('/api/') && !request.path.startsWith('/socket.io')) })); app.use(express.json({ limit: '2mb', verify: (request, _response, buffer) => { (request as typeof request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer) } }))
app.use(requestObservability(config.SLOW_REQUEST_MS))
app.use(createHealthRouter({ redisConfigured: Boolean(config.REDIS_URL) }))
app.use('/api/auth', authRoutes); app.use('/api/devices', deviceRoutes); app.use('/api/public', publicTrackingRoutes); app.use('/api/customer', customerRoutes); app.use('/api/customer', customerExtendedRoutes); app.use('/api/vendor', vendorRoutes); app.use('/api/vendor', vendorExtendedRoutes); app.use('/api/admin', adminRoutes); app.use('/api/admin', adminExtendedRoutes); app.use('/api/admin', adminSmsTemplateRoutes); app.use('/api/payment', paymentRoutes); app.use('/api/uploads', uploadRoutes); app.use('/api/support', supportRoutes); app.use('/api/analytics', analyticsRoutes); app.use('/api/partner', partnerRoutes); app.use(errorHandler)
if (serveFrontend) app.use(express.static(frontendDist, { index: 'index.html', setHeaders: (response, filePath) => {
  if (filePath.endsWith('index.html')) {
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  } else if (filePath.includes('/assets/')) {
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  } else {
    response.setHeader('Cache-Control', 'public, max-age=86400')
  }
} }))
if (serveFrontend) app.use((request, response, next) => { if (request.method !== 'GET' || request.path.startsWith('/api') || request.path.startsWith('/health') || request.path.startsWith('/socket.io')) return next(); response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); response.sendFile(resolve(frontendDist, 'index.html')) })
const io = new Server(httpServer, { cors: corsOptions, adapter: socketAdapterFor(redis) })
io.use(async (socket, next) => {
  const rejectSocket = (reason: string, message: string, detail?: string) => {
    logger.warn('realtime.auth_failed', { reason, origin: socket.handshake.headers.origin ?? null, detail })
    next(new Error(message))
  }
  try {
    const token = socket.handshake.auth?.token
    if (typeof token !== 'string' || !token) return rejectSocket('missing_token', 'Authentication required')
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data.user) return rejectSocket('invalid_session', 'Invalid session', error?.message)
    socket.data.userId = data.user.id
    next()
  } catch (error) {
    rejectSocket('auth_error', 'Realtime authentication failed', error instanceof Error ? error.message : String(error))
  }
})
// Resolves the role and vendor for a socket. Returns null when the lookup fails, and the caller disconnects.
async function loadSocketContext(userId: string) {
  try {
    const [{ data: profile, error: profileError }, { data: vendor, error: vendorError }] = await Promise.all([
      supabase.from('profiles').select('role').eq('id', userId).maybeSingle(),
      supabase.from('vendors').select('id').eq('owner_profile_id', userId).maybeSingle(),
    ])
    if (profileError || vendorError) {
      logger.error('realtime.user_context_failed', { userId, profileError: profileError?.message, vendorError: vendorError?.message })
      return null
    }
    return { role: profile?.role ?? null, vendor: vendor ?? null }
  } catch (error) {
    logger.error('realtime.user_context_failed', { userId, error: error instanceof Error ? error.message : String(error) })
    return null
  }
}
async function handleConnection(socket: Socket) {
  let joinWindowStartedAt = Date.now()
  let joinCount = 0
  const joinedBookingRooms = new Set<string>()
  const onSocketEvent = (event: string, handler: (...args: unknown[]) => unknown) => socket.on(event, async (...args: unknown[]) => {
    try {
      await handler(...args)
    } catch (error) {
      logger.error('realtime.handler_failed', { socketEvent: event, userId: socket.data.userId, error: error instanceof Error ? error.message : String(error) })
    }
  })
  socket.join(`customer:${socket.data.userId}`)
  // Handlers are registered before the context lookup finishes, so a join sent right after connect is not dropped; each waits for the lookup.
  const contextReady = loadSocketContext(socket.data.userId)
  onSocketEvent('vendor:join', async (vendorId: unknown) => {
    const context = await contextReady
    if (typeof vendorId !== 'string' || !context?.vendor || context.vendor.id !== vendorId) return
    socket.join(`vendor:${vendorId}`)
  })
  onSocketEvent('booking:leave', (bookingId: unknown) => {
    if (typeof bookingId !== 'string' || !joinedBookingRooms.has(bookingId)) return
    joinedBookingRooms.delete(bookingId)
    void socket.leave(`booking:${bookingId}`)
  })
  onSocketEvent('booking:join', async (bookingId: unknown) => {
    if (typeof bookingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(bookingId)) return
    if (Date.now() - joinWindowStartedAt >= 60_000) { joinWindowStartedAt = Date.now(); joinCount = 0 }
    if (joinCount >= 30 || (joinedBookingRooms.size >= 20 && !joinedBookingRooms.has(bookingId))) return
    joinCount += 1
    try {
      const context = await contextReady
      if (!context) return
      const { data: booking, error } = await supabase.from('bookings').select('customer_id,vendor_id').eq('id', bookingId).maybeSingle()
      if (error) throw error
      if (!booking) return
      const isCustomer = booking.customer_id === socket.data.userId
      const isAdmin = context.role === 'admin'
      const isVendor = Boolean(context.vendor?.id && booking.vendor_id === context.vendor.id)
      if (isCustomer || isAdmin || isVendor) { joinedBookingRooms.add(bookingId); socket.join(`booking:${bookingId}`) }
    } catch (error) {
      logger.warn('realtime.booking_room_join_failed', { userId: socket.data.userId, error: error instanceof Error ? error.message : String(error) })
    }
  })
  const context = await contextReady
  if (!context) {
    socket.disconnect(true)
    return
  }
  if (context.role === 'admin') socket.join('admins')
  if (context.vendor) socket.join(`vendor:${context.vendor.id}`)
  socket.emit('connected', { service: 'urban-tanker-realtime', vendorId: context.vendor?.id ?? null, role: context.role })
}
io.on('connection', (socket) => {
  handleConnection(socket).catch((error) => {
    logger.error('realtime.connection_failed', { userId: socket.data.userId, error: error instanceof Error ? error.message : String(error) })
    socket.disconnect(true)
  })
})
setRealtimeServer(io)
const stopBackgroundJobs = startBackgroundJobs()
const shutdown = (signal: string) => {
  logger.info('server.shutdown', { signal })
  stopBackgroundJobs()
  io.close(() => httpServer.close(() => { void closeRedisPair(redis).finally(() => process.exit(0)) }))
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
process.on('unhandledRejection', (reason) => {
  logger.error('process.unhandled_rejection', { error: reason instanceof Error ? reason.message : String(reason) })
})
warnIfSingleInstanceInProduction()
httpServer.listen(config.PORT, () => {
  if (config.NODE_ENV === 'development') {
    console.log(startupBanner({ port: config.PORT, logLevel: config.LOG_LEVEL, frontendOrigin: config.FRONTEND_ORIGIN }))
  } else {
    logger.success('server.listening', { port: config.PORT, environment: config.NODE_ENV, logLevel: config.LOG_LEVEL })
  }
})
