export const partnerContent = {
  hero: {
    eyebrow: 'GROW WITH URBAN TANKER',
    titleLead: 'Your expertise.',
    titleEmphasis: 'A wider network.',
    copy: 'Join a trusted service network, manage your availability and receive suitable customer requirements in your operating area.',
    highlights: [
      { value: 'Simple', label: 'guided application' },
      { value: 'Verified', label: 'partner identity' },
      { value: 'Flexible', label: 'service availability' },
    ],
  },
  intro: {
    eyebrow: 'PARTNER APPLICATION',
    title: 'Tell us about your business',
    copy: 'Most applications take only a few minutes. You can provide final verification documents during review.',
    badge: 'Step-by-step',
  },
  sections: {
    business: {
      number: '1',
      title: 'Business & contact',
      copy: 'How our verification team can reach you.',
    },
    services: {
      number: '2',
      title: 'Services you provide',
      copy: 'Select every service your team can fulfil.',
      legend: 'Services offered',
    },
    fleet: {
      number: '3',
      title: 'Fleet & readiness',
      copy: 'Give us a quick operational overview.',
    },
  },
  fields: {
    businessName: {
      label: 'Business / owner name',
      placeholder: 'Enter registered or owner name',
    },
    partnerType: {
      label: 'Partner type',
      placeholder: 'Choose partner type',
    },
    phone: {
      label: 'Mobile number',
      placeholder: '10-digit mobile number',
    },
    whatsapp: {
      label: 'WhatsApp number',
      placeholder: 'Leave blank if same as mobile',
    },
    email: {
      label: 'Email address',
      placeholder: 'name@business.com',
    },
    zone: {
      label: 'Primary operating area',
      placeholder: 'Adyar, OMR, Anna Nagar…',
    },
    address: {
      label: 'Business address',
      placeholder: 'Door number, street, locality and city',
    },
    vehicleCount: {
      label: 'Number of vehicles',
      placeholder: '1',
    },
    registration: {
      label: 'Primary vehicle registration',
      placeholder: 'TN 09 AB 1234',
    },
    capacity: {
      label: 'Vehicle capacity',
      placeholder: 'e.g. 6 KL or 7 m³',
    },
    experience: {
      label: 'Years in operation',
      placeholder: 'e.g. 5',
    },
    availability: {
      label: 'Current availability',
    },
    documents: {
      label: 'Verification documents',
      hint: 'Upload RC, insurance, permits, or business proof.',
    },
    notes: {
      label: 'Anything else we should know?',
      placeholder: 'Coverage area, special equipment, additional vehicles or working hours',
    },
  },
  options: {
    partnerTypes: [
      { label: 'Individual vehicle owner' },
      { label: 'Fleet operator' },
      { label: 'Service contractor' },
      { label: 'Company' },
    ],
    serviceOffers: [
      { code: 'Water tanker', label: 'Water tanker' },
      { code: 'Sewage suction', label: 'Sewage suction' },
      { code: 'Drinking water supply', label: 'Drinking water supply' },
      { code: 'Tank and sump cleaning', label: 'Tank and sump cleaning' },
      { code: 'Borewell services', label: 'Borewell services' },
      { code: 'RMC mix / ready-mix concrete', label: 'RMC mix / ready-mix concrete' },
      { code: 'Empty tanker and bulk-liquid transport', label: 'Empty tanker and bulk-liquid transport' },
      { code: 'Emergency water and sewage', label: 'Emergency water and sewage' },
    ],
    availability: [
      { label: 'Available for new orders' },
      { label: 'Available on selected days' },
      { label: 'Onboarding for future orders' },
    ],
  },
  declaration: 'I confirm that the information is accurate and required verification documents can be provided.',
  actions: {
    submit: 'Submit partnership request',
    continueToVendorLogin: 'Continue to vendor login',
    openWorkspace: 'Open my workspace',
    goToVendorLogin: 'Go to vendor login',
  },
  nextSteps: {
    eyebrow: 'WHAT HAPPENS NEXT',
    title: 'A clear path to activation.',
    steps: [
      { title: 'Application review', copy: 'We check your service area and basic business details.' },
      { title: 'Document verification', copy: 'Vehicles and drivers are verified separately.' },
      { title: 'Availability setup', copy: 'Choose which approved services and vehicles are active.' },
      { title: 'Start receiving requests', copy: 'Eligible bookings can be offered to your account.' },
    ],
  },
  help: {
    title: 'Already registered?',
    copy: 'Use your vendor account to manage vehicles, drivers and service availability.',
  },
  messages: {
    chooseService: 'Choose at least one service you can provide.',
    submitFailed: 'The partner application could not be submitted.',
    submitted: (message: string, reference: string) => `${message} Reference: ${reference}`,
  },
} as const
