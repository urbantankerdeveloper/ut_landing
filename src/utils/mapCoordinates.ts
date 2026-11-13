export type MapPoint = { lat: number; lng: number }

export function calculateBearing(from: MapPoint, to: MapPoint) {
  const toRadians = (degrees: number) => degrees * Math.PI / 180
  const toDegrees = (radians: number) => radians * 180 / Math.PI
  const fromLatitude = toRadians(from.lat)
  const toLatitude = toRadians(to.lat)
  const longitudeDelta = toRadians(to.lng - from.lng)
  const y = Math.sin(longitudeDelta) * Math.cos(toLatitude)
  const x = Math.cos(fromLatitude) * Math.sin(toLatitude) - Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(longitudeDelta)
  return (toDegrees(Math.atan2(y, x)) + 360) % 360
}
