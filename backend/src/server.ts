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
import { resolveIdentity } from './middleware/auth.js'
import { loadAuthContext } from './services/authContext.js'
import { flushAuditQueue, stopAuditBatcher } from './services/auditLog.js'
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
  try {
    const token = socket.handshake.auth?.token
    if (typeof token !== 'string' || !token) return next(new Error('Authentication required'))
    const identity = await resolveIdentity(token)
    if (!identity) return next(new Error('Invalid session'))
    socket.data.userId = identity.id
    next()
  } catch {
    next(new Error('Realtime authentication failed'))
  }
})
async function handleConnection(socket: Socket) {
  let joinWindowStartedAt = Date.now()
  let joinCount = 0
  const joinedBookingRooms = new Set<string>()
  const onSocketEvent = (event: string, handler: (...args: unknown[]) => unknown) => socket.on(event, async (...args: unknown[]) => {
    try {
      await handler(...args)
    } catch (error) {
      console.error(JSON.stringify({ event: 'realtime.handler_failed', socketEvent: event, userId: socket.data.userId, error: error instanceof Error ? error.message : String(error) }))
    }
  })
  socket.join(`customer:${socket.data.userId}`)
  let context: Awaited<ReturnType<typeof loadAuthContext>>
  try {
    context = await loadAuthContext(socket.data.userId)
  } catch (error) {
    console.error(JSON.stringify({ event: 'realtime.user_context_failed', userId: socket.data.userId, error: error instanceof Error ? error.message : String(error) }))
    socket.disconnect(true)
    return
  }
  const profile = context ? { role: context.role } : null
  const vendor = context?.vendorId ? { id: context.vendorId } : null
  // Booking ownership for this connection. Cached for the connection's lifetime, so a repeated join does not query again.
  const bookingOwners = new Map<string, { customer_id: string | null; vendor_id: string | null }>()
  if (profile?.role === 'admin') socket.join('admins')
  if (vendor) socket.join(`vendor:${vendor.id}`)
  socket.emit('connected', { service: 'urban-tanker-realtime', vendorId: vendor?.id ?? null, role: profile?.role ?? null })
  onSocketEvent('vendor:join', (vendorId: unknown) => {
    if (typeof vendorId !== 'string' || !vendor || vendor.id !== vendorId) return
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
      let booking = bookingOwners.get(bookingId)
      if (!booking) {
        const { data, error } = await supabase.from('bookings').select('customer_id,vendor_id').eq('id', bookingId).maybeSingle()
        if (error) throw error
        if (!data) return
        booking = data
        bookingOwners.set(bookingId, data)
      }
      const isCustomer = booking.customer_id === socket.data.userId
      const isAdmin = profile?.role === 'admin'
      const isVendor = Boolean(vendor?.id && booking.vendor_id === vendor.id)
      if (isCustomer || isAdmin || isVendor) { joinedBookingRooms.add(bookingId); socket.join(`booking:${bookingId}`) }
    } catch (error) {
      console.warn(JSON.stringify({ event: 'realtime.booking_room_join_failed', userId: socket.data.userId, error: error instanceof Error ? error.message : String(error) }))
    }
  })
}
io.on('connection', (socket) => {
  handleConnection(socket).catch((error) => {
    console.error(JSON.stringify({ event: 'realtime.connection_failed', userId: socket.data.userId, error: error instanceof Error ? error.message : String(error) }))
    socket.disconnect(true)
  })
})
setRealtimeServer(io)
const stopBackgroundJobs = startBackgroundJobs()
const shutdown = (signal: string) => {
  console.info(JSON.stringify({ event: 'server.shutdown', signal }))
  stopBackgroundJobs()
  io.close(() => httpServer.close(() => { void flushAuditQueue().finally(() => stopAuditBatcher()).then(() => closeRedisPair(redis)).finally(() => process.exit(0)) }))
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
process.on('unhandledRejection', (reason) => {
  console.error(JSON.stringify({ event: 'process.unhandled_rejection', error: reason instanceof Error ? reason.message : String(reason) }))
})
warnIfSingleInstanceInProduction()
httpServer.listen(config.PORT, () => console.log(`Urban Tanker API listening on ${config.PORT}`))
