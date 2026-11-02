// Location picker and live map text. Kept separate from the booking and tracking modules because these components are shared.
export const locationContent = {
  picker: {
    attribution: '© OpenStreetMap contributors',
  },
  modal: {
    title: 'Select delivery location',
    hint: 'Click on the map to choose the delivery point, or use your browser location.',
    outsideChennai: 'We currently deliver only within Chennai. Please choose another location inside Chennai.',
    lookupFailed: 'We could not verify this location. Please try again or choose another location inside Chennai.',
    selectedArea: (latitude: string, longitude: string) => `Selected delivery area (${latitude}, ${longitude})`,
    finding: 'Finding nearby area…',
    findingButton: 'Finding area…',
    useLocation: 'Use this location',
  },
  map: {
    attribution: '© OpenStreetMap contributors',
    waiting: 'Waiting for the fleet to start sharing its live location.',
    fleet: 'Fleet',
    deliveryPoint: 'Delivery point',
  },
} as const
