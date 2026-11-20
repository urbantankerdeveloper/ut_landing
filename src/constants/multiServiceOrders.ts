export const multiServiceOrdersUiEnabled =
  import.meta.env.VITE_MULTI_SERVICE_ORDERS_ENABLED === 'true'

export function isMultiServiceOrdersEnabled(serverEnabled?: boolean) {
  return multiServiceOrdersUiEnabled && serverEnabled === true
}
