export type OptionalCoordinates = {
  latitude?: number
  longitude?: number
}

export function parseOptionalCoordinates(
  latitude: FormDataEntryValue | null,
  longitude: FormDataEntryValue | null,
): OptionalCoordinates {
  const latitudeText = String(latitude ?? '').trim()
  const longitudeText = String(longitude ?? '').trim()
  if (!latitudeText && !longitudeText) return {}
  if (!latitudeText || !longitudeText) {
    throw new Error('Enter both latitude and longitude.')
  }

  const latitudeValue = Number(latitudeText)
  const longitudeValue = Number(longitudeText)
  if (
    !Number.isFinite(latitudeValue) ||
    !Number.isFinite(longitudeValue) ||
    latitudeValue < -90 ||
    latitudeValue > 90 ||
    longitudeValue < -180 ||
    longitudeValue > 180
  ) {
    throw new Error('Enter valid latitude and longitude values.')
  }
  return { latitude: latitudeValue, longitude: longitudeValue }
}
