const configuredValue = import.meta.env.VITE_ENABLE_DEMO_DATA

export const demoDataEnabled = configuredValue === 'true'
export const customerDemoDataEnabled = false
