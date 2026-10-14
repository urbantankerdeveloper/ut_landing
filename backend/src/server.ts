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
import { errorHandler } from './middleware/errors.js'
import { startBackgroundJobs } from './services/jobs.js'
import { supabase } from './supabase.js'
import { setRealtimeServer } from './services/realtime.js'
import { requestObservability } from './middleware/observability.js'
const app = express(); const httpServer = createServer(app)
const frontendDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist')
app.set('trust proxy', 1)
app.use(helmet()); app.use(cors({ origin: config.FRONTEND_ORIGIN, credentials: true })); app.use(compression()); app.use(express.json({ limit: '2mb', verify: (request, _response, buffer) => { (request as typeof request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer) } })); app.use(rateLimit({ windowMs: 60_000, limit: 120 }))
app.use(requestObservability); app.get('/health', (_request, response) => response.json({ ok: true, service: 'urban-tanker-api' }))
app.use('/api/auth', authRoutes); app.use('/api/customer', customerRoutes); app.use('/api/customer', customerExtendedRoutes); app.use('/api/vendor', vendorRoutes); app.use('/api/vendor', vendorExtendedRoutes); app.use('/api/admin', adminRoutes); app.use('/api/admin', adminExtendedRoutes); app.use('/api/payment', paymentRoutes); app.use('/api/uploads', uploadRoutes); app.use('/api/support', supportRoutes); app.use(errorHandler)
app.use(express.static(frontendDist, { index: 'index.html', maxAge: '1y', immutable: true }))
app.use((request, response, next) => { if (request.method !== 'GET' || request.path.startsWith('/api') || request.path === '/health' || request.path.startsWith('/socket.io')) return next(); response.sendFile(resolve(frontendDist, 'index.html')) })
const io = new Server(httpServer, { cors: { origin: config.FRONTEND_ORIGIN, credentials: true } }); io.use(async (socket, next) => { const token = socket.handshake.auth?.token; if (!token) return next(new Error('Authentication required')); const { data } = await supabase.auth.getUser(token); if (!data.user) return next(new Error('Invalid session')); socket.data.userId = data.user.id; next() }); io.on('connection', async (socket) => { socket.join(`customer:${socket.data.userId}`); const { data: profile } = await supabase.from('profiles').select('role').eq('id', socket.data.userId).maybeSingle(); if (profile?.role === 'admin') socket.join('admins'); const { data: vendor } = await supabase.from('vendors').select('id').eq('owner_profile_id', socket.data.userId).maybeSingle(); if (vendor) socket.join(`vendor:${vendor.id}`); socket.emit('connected', { service: 'urban-tanker-realtime', vendorId: vendor?.id ?? null, role: profile?.role ?? null }); socket.on('vendor:join', (vendorId: string) => socket.join(`vendor:${vendorId}`)); socket.on('booking:join', (bookingId: string) => socket.join(`booking:${bookingId}`)) })
setRealtimeServer(io)
startBackgroundJobs()
httpServer.listen(config.PORT, () => console.log(`Urban Tanker API listening on ${config.PORT}`))
