export type SocketTransport = 'polling' | 'websocket'

export function socketIoTransportOptions(transports: readonly SocketTransport[]) {
  return {
    transports: [...transports],
    allowUpgrades: transports.includes('websocket'),
  }
}
