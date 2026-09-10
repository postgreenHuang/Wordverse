export type ScreenPoint = { x: number; y: number }

export function pointInPolygon(point: ScreenPoint, polygon: ScreenPoint[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || .00001) + a.x) inside = !inside
  }
  return inside
}

export function segmentsIntersect(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint, d: ScreenPoint): boolean {
  const cross = (p: ScreenPoint, q: ScreenPoint, r: ScreenPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const onSegment = (p: ScreenPoint, q: ScreenPoint, r: ScreenPoint) => Math.abs(cross(p, q, r)) < .0001 && r.x >= Math.min(p.x, q.x) && r.x <= Math.max(p.x, q.x) && r.y >= Math.min(p.y, q.y) && r.y <= Math.max(p.y, q.y)
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b)
  if (((abC < 0 && abD > 0) || (abC > 0 && abD < 0)) && ((cdA < 0 && cdB > 0) || (cdA > 0 && cdB < 0))) return true
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
}

export function segmentHitsBox(a: ScreenPoint, b: ScreenPoint, minX: number, maxX: number, minY: number, maxY: number): boolean {
  const inside = (point: ScreenPoint) => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
  if (inside(a) || inside(b)) return true
  const topLeft = { x: minX, y: minY }, topRight = { x: maxX, y: minY }, bottomRight = { x: maxX, y: maxY }, bottomLeft = { x: minX, y: maxY }
  return segmentsIntersect(a, b, topLeft, topRight) || segmentsIntersect(a, b, topRight, bottomRight) || segmentsIntersect(a, b, bottomRight, bottomLeft) || segmentsIntersect(a, b, bottomLeft, topLeft)
}

export function segmentHitsPolygon(a: ScreenPoint, b: ScreenPoint, polygon: ScreenPoint[]): boolean {
  if (polygon.length < 3) return false
  if (pointInPolygon(a, polygon) || pointInPolygon(b, polygon)) return true
  return polygon.some((point, index) => segmentsIntersect(a, b, point, polygon[(index + 1) % polygon.length]))
}