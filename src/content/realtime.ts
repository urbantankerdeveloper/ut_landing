// Wording matches the mobile app's realtime notices so both clients tell users the same thing.
export const realtimeContent = {
  unreadLabel: (count: number) => `${count} unread`,
  customer: {
    accepted: 'Your vendor accepted the booking.',
    dispatched: 'Your tanker has been dispatched.',
    en_route: 'Your tanker is on the way.',
    arrived: 'Your tanker has arrived.',
    delivered: 'Your delivery is complete.',
    cancelled: 'Your booking was cancelled.',
    newNotification: 'You have a new notification.',
  },
  vendor: {
    newOrder: (reference: string) => `New order ${reference} is available. Open Operations to accept.`,
    taken: (reference: string) => `Order ${reference} was accepted by another vendor.`,
    declined: (reference: string) => `Order ${reference} was declined.`,
  },
} as const
