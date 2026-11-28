import { once } from 'node:events'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Server } from 'socket.io'
import { socketIoTransportOptions } from './socketIoOptions.js'

describe('Socket.IO polling transport configuration', () => {
  let io: Server | undefined

  afterEach(async () => {
    if (io) {
      await new Promise<void>((resolve) => io!.close(() => resolve()))
      io = undefined
    }
  })

  it('delivers events over polling and advertises no upgrades when polling is configured', async () => {
    const httpServer = createServer()
    io = new Server(httpServer, socketIoTransportOptions(['polling']))
    io.on('connection', (socket) => socket.emit('test.event', { delivered: true }))
    httpServer.listen(0, '127.0.0.1')
    await once(httpServer, 'listening')

    const address = httpServer.address()
    if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP server address')
    const endpoint = `http://127.0.0.1:${address.port}/socket.io/`
    const pollingUrl = (sid?: string) => {
      const url = new URL(endpoint)
      url.searchParams.set('EIO', '4')
      url.searchParams.set('transport', 'polling')
      if (sid) url.searchParams.set('sid', sid)
      return url
    }

    const handshakeResponse = await fetch(pollingUrl())
    expect(handshakeResponse.ok).toBe(true)
    const handshakePacket = await handshakeResponse.text()
    expect(handshakePacket.startsWith('0')).toBe(true)
    const handshake = JSON.parse(handshakePacket.slice(1)) as { sid: string; upgrades: string[] }
    expect(handshake.upgrades).toEqual([])

    const connectResponse = await fetch(pollingUrl(handshake.sid), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: '40',
    })
    expect(connectResponse.ok).toBe(true)

    const eventResponse = await fetch(pollingUrl(handshake.sid))
    expect(eventResponse.ok).toBe(true)
    const packets = (await eventResponse.text()).split('\u001e')
    const eventPacket = packets.find((packet) => packet.startsWith('42'))
    expect(eventPacket).toBeDefined()
    expect(JSON.parse(eventPacket!.slice(2))).toEqual(['test.event', { delivered: true }])
  })
})
