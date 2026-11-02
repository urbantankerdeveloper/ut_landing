export const subscriptionsContent = {
  intro: {
    eyebrow: 'SUBSCRIPTIONS',
    title: 'Reliable water, already planned.',
    body: 'Set a recurring tanker schedule for your home, apartment or business. Pause, skip or change anytime.',
  },
  plans: [
    {
      id: 'homeLite',
      name: 'Home tanker lite',
      price: '₹1,799',
      detail: 'A delivery every 10–14 days',
      featured: false,
      isCustomPrice: false,
    },
    {
      id: 'propertyCare',
      name: 'Property care',
      price: '₹6,500',
      detail: 'Five scheduled deliveries each month',
      featured: true,
      isCustomPrice: false,
    },
    {
      id: 'sitePartner',
      name: 'Site partner',
      price: 'Custom',
      detail: 'Flexible capacity for active projects',
      featured: false,
      isCustomPrice: true,
    },
  ],
  featuredBadge: 'MOST POPULAR',
  priceSuffix: ' / month',
  choosePlan: 'Choose plan',
  features: [
    { id: 'predictable', title: 'Predictable delivery', copy: 'Set a schedule that works for your property.' },
    { id: 'flexible', title: 'Stay flexible', copy: 'Pause, skip or change without a call.' },
    { id: 'fulfilment', title: 'Trusted fulfilment', copy: 'Verified vendors with live status updates.' },
  ],
} as const
