import express from 'express'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import compression from 'compression'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { config } from './config.js'
import authRoutes from './routes/auth.js'
import customerRoutes from './routes/customer.js'
import vendorRoutes from './routes/vendor.js'
import adminRoutes from './routes/admin.js'
import customerExtendedRoutes from './routes/customerExtended.js'
import vendorExtendedRoutes from './routes/vendorExtended.js'
import adminExtendedRoutes from './routes/adminExtended.js'
import paymentRoutes from './routes/payments.js'
import uploadRoutes from './routes/uploads.js'
import supportRoutes from './routes/support.js'
import analyticsRoutes from './routes/analytics.js'
import partnerRoutes from './routes/partner.js'
import deviceRoutes from './routes/devices.js'
import { errorHandler } from './middleware/errors.js'
import { startBackgroundJobs } from './services/jobs.js'
import { supabase } from './supabase.js'
import { setRealtimeServer } from './services/realtime.js'
import { requestObservability } from './middleware/observability.js'
import { checkDatabaseConnection } from './database.js'
const app = express(); const httpServer = createServer(app)
const frontendDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist')
const allowedOrigins = [config.FRONTEND_ORIGIN, 'https://urban-tanker-backend.onrender.com']
app.set('trust proxy', 1)
app.use(helmet()); app.use(cors({ origin: allowedOrigins, credentials: true })); app.use(compression()); app.use(express.json({ limit: '2mb', verify: (request, _response, buffer) => { (request as typeof request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer) } })); app.use(rateLimit({ windowMs: 60_000, limit: 120 }))
app.use(requestObservability)
app.get('/health', (_request, response) => response.json({ ok: true, service: 'urban-tanker-api' }))
app.get('/health/ready', async (_request, response) => {
  const databaseReady = await checkDatabaseConnection()
  response.status(databaseReady ? 200 : 503).json({ ok: databaseReady, service: 'urban-tanker-api', database: databaseReady ? 'ready' : 'unavailable' })
})
app.use('/api/auth', authRoutes); app.use('/api/devices', deviceRoutes); app.use('/api/customer', customerRoutes); app.use('/api/customer', customerExtendedRoutes); app.use('/api/vendor', vendorRoutes); app.use('/api/vendor', vendorExtendedRoutes); app.use('/api/admin', adminRoutes); app.use('/api/admin', adminExtendedRoutes); app.use('/api/payment', paymentRoutes); app.use('/api/uploads', uploadRoutes); app.use('/api/support', supportRoutes); app.use('/api/analytics', analyticsRoutes); app.use('/api/partner', partnerRoutes); app.use(errorHandler)
app.use(express.static(frontendDist, { index: 'index.html', maxAge: '1y', immutable: true, setHeaders: (response, filePath) => { if (filePath.endsWith('index.html')) response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate') } }))
app.use((request, response, next) => { if (request.method !== 'GET' || request.path.startsWith('/api') || request.path.startsWith('/health') || request.path.startsWith('/socket.io')) return next(); response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); response.sendFile(resolve(frontendDist, 'index.html')) })
const io = new Server(httpServer, { cors: { origin: allowedOrigins, credentials: true } })
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token
  if (typeof token !== 'string' || !token) return next(new Error('Authentication required'))
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return next(new Error('Invalid session'))
  socket.data.userId = data.user.id
  next()
})
io.on('connection', async (socket) => {
  let joinWindowStartedAt = Date.now()
  let joinCount = 0
  const joinedBookingRooms = new Set<string>()
  socket.join(`customer:${socket.data.userId}`)
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', socket.data.userId).maybeSingle()
  if (profile?.role === 'admin') socket.join('admins')
  const { data: vendor } = await supabase.from('vendors').select('id').eq('owner_profile_id', socket.data.userId).maybeSingle()
  if (vendor) socket.join(`vendor:${vendor.id}`)
  socket.emit('connected', { service: 'urban-tanker-realtime', vendorId: vendor?.id ?? null, role: profile?.role ?? null })
  socket.on('vendor:join', (vendorId: unknown) => { if (vendor?.id === vendorId) socket.join(`vendor:${vendorId}`) })
  socket.on('booking:join', async (bookingId: unknown) => {
    if (typeof bookingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(bookingId)) return
    if (Date.now() - joinWindowStartedAt >= 60_000) { joinWindowStartedAt = Date.now(); joinCount = 0 }
    if (joinCount >= 30 || (joinedBookingRooms.size >= 20 && !joinedBookingRooms.has(bookingId))) return
    joinCount += 1
    const { data: booking } = await supabase.from('bookings').select('customer_id,vendor_id').eq('id', bookingId).maybeSingle()
    if (!booking) return
    const isCustomer = booking.customer_id === socket.data.userId
    const isAdmin = profile?.role === 'admin'
    const isVendor = Boolean(vendor?.id && booking.vendor_id === vendor.id)
    if (isCustomer || isAdmin || isVendor) { joinedBookingRooms.add(bookingId); socket.join(`booking:${bookingId}`) }
  })
})
setRealtimeServer(io)
const stopBackgroundJobs = startBackgroundJobs()
const shutdown = (signal: string) => {
  console.info(JSON.stringify({ event: 'server.shutdown', signal }))
  stopBackgroundJobs()
  io.close(() => httpServer.close(() => process.exit(0)))
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
httpServer.listen(config.PORT, () => console.log(`Urban Tanker API listening on ${config.PORT}`))
