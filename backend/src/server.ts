import express from 'express'
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
import { errorHandler } from './middleware/errors.js'
import { startBackgroundJobs } from './services/jobs.js'
import { supabase } from './supabase.js'
import { setRealtimeServer } from './services/realtime.js'
const app = express(); const httpServer = createServer(app)
app.use(helmet()); app.use(cors({ origin: config.FRONTEND_ORIGIN, credentials: true })); app.use(compression()); app.use(express.json({ limit: '2mb', verify: (request, _response, buffer) => { (request as typeof request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer) } })); app.use(rateLimit({ windowMs: 60_000, limit: 120 }))
app.get('/health', (_request, response) => response.json({ ok: true, service: 'urban-tanker-api' }))
app.use('/api/auth', authRoutes); app.use('/api/customer', customerRoutes); app.use('/api/customer', customerExtendedRoutes); app.use('/api/vendor', vendorRoutes); app.use('/api/vendor', vendorExtendedRoutes); app.use('/api/admin', adminRoutes); app.use('/api/admin', adminExtendedRoutes); app.use('/api/payment', paymentRoutes); app.use('/api/uploads', uploadRoutes); app.use(errorHandler)
const io = new Server(httpServer, { cors: { origin: config.FRONTEND_ORIGIN, credentials: true } }); io.use(async (socket, next) => { const token = socket.handshake.auth?.token; if (!token) return next(new Error('Authentication required')); const { data } = await supabase.auth.getUser(token); if (!data.user) return next(new Error('Invalid session')); socket.data.userId = data.user.id; next() }); io.on('connection', (socket) => { socket.emit('connected', { service: 'urban-tanker-realtime' }); socket.on('vendor:join', (vendorId: string) => socket.join(`vendor:${vendorId}`)); socket.on('booking:join', (bookingId: string) => socket.join(`booking:${bookingId}`)) })
setRealtimeServer(io)
startBackgroundJobs()
httpServer.listen(config.PORT, () => console.log(`Urban Tanker API listening on ${config.PORT}`))
