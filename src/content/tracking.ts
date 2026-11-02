export const trackingContent = {
  eyebrow: 'URBAN TANKER LIVE TRACKING',
  loading: 'Loading live tracking…',
  unavailable: {
    title: 'Tracking link unavailable',
    body: 'This tracking link is invalid, expired, or no longer active.',
  },
  status: {
    labels: {
      pending_vendor: 'Request received',
      vendor_assigned: 'Vendor assigned',
      accepted: 'Accepted',
      en_route: 'On the way',
      arrived: 'Arrived',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
    },
    fallback: 'Delivery update',
  },
  chooser: {
    title: 'Track your delivery',
    intro: 'Open the live map in the Urban Tanker app, or continue in your browser.',
    openApp: 'Open in Urban Tanker app',
    continueBrowser: 'Continue in browser',
    fallbackHint: 'If the app does not open, continue in your browser.',
  },
  details: {
    bookingPrefix: 'Booking ',
    deliveryStatusEyebrow: 'DELIVERY STATUS',
    refresh: 'Refresh',
    waitingTitle: 'Waiting for a live location',
    waitingBody: 'The vehicle location will appear when the delivery is en route.',
    vehicleLabel: 'Vehicle',
    vehicleFallback: 'Assigning nearby tanker',
    driverLabel: 'Driver',
    driverFallback: 'Not assigned yet',
    expectedLabel: 'Expected delivery',
    expectedFallback: 'Updating shortly',
  },
  timeline: {
    eyebrow: 'DELIVERY UPDATES',
    heading: 'Booking timeline',
    eventFallbackNote: 'Booking status updated.',
  },
  map: {
    attribution: '© OpenStreetMap contributors',
    legend: 'Fleet last known location',
  },
} as const
