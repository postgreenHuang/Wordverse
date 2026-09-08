import { Vector3 } from 'three'
import type { WordNode } from './types'

const goldenAngle = Math.PI * (3 - Math.sqrt(5))

function deterministicDirection(first: string, second: string) {
  const ordered = first < second ? `${first}:${second}` : `${second}:${first}`
  const seed = ordered.split('').reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 2166136261)
  const y = ((seed % 2001) / 1000) - 1
  const angle = ((seed >>> 8) % 4096) / 4096 * Math.PI * 2
  const ring = Math.sqrt(Math.max(0, 1 - y * y))
  const direction = new Vector3(Math.cos(angle) * ring, y, Math.sin(angle) * ring).normalize()
  return first < second ? direction : direction.multiplyScalar(-1)
}

export function balancedPosition(nodes: WordNode[]): [number, number, number] {
  if (!nodes.length) return [0, 0, 0]
  const center = nodes.reduce((sum, node) => sum.add(new Vector3(...node.position)), new Vector3()).multiplyScalar(1 / nodes.length)
  const radius = Math.min(4.6, 2.35 + Math.cbrt(nodes.length) * .38)
  let best = new Vector3(center.x, center.y, center.z + radius)
  let bestScore = -Infinity
  for (let i = 0; i < 96; i++) {
    const y = 1 - (i / 95) * 2
    const ring = Math.sqrt(Math.max(0, 1 - y * y))
    const direction = new Vector3(Math.cos(i * goldenAngle) * ring, y, Math.sin(i * goldenAngle) * ring * 1.35).normalize()
    const candidate = center.clone().add(direction.multiplyScalar(radius))
    const distances = nodes.map(node => candidate.distanceTo(new Vector3(...node.position)))
    const nearest = Math.min(...distances)
    const mean = distances.reduce((sum, distance) => sum + distance, 0) / distances.length
    const score = nearest - Math.abs(mean - radius * 1.18) * .18
    if (score > bestScore) { bestScore = score; best = candidate }
  }
  return [best.x, best.y, best.z]
}

export function boundedIntentPosition(nodes: WordNode[], requested: [number, number, number]): [number, number, number] {
  if (!nodes.length) return requested
  const center = nodes.reduce((sum, node) => sum.add(new Vector3(...node.position)), new Vector3()).multiplyScalar(1 / nodes.length)
  const intended = new Vector3(...requested)
  const offset = intended.sub(center)
  const maximumRadius = Math.min(6.2, 3.4 + Math.cbrt(nodes.length) * .42)
  if (offset.length() > maximumRadius) offset.setLength(maximumRadius)
  const result = center.add(offset)
  return [result.x, result.y, result.z]
}

export function nearbyIntentPosition(nodes: WordNode[], requested: [number, number, number]): [number, number, number] {
  if (!nodes.length) return requested
  const intent = new Vector3(...requested)
  const nearestDistance = (point: Vector3) => Math.min(...nodes.map(node => point.distanceTo(new Vector3(...node.position))))
  if (nearestDistance(intent) >= 1.25) return requested
  let best = intent.clone()
  let bestScore = nearestDistance(best)
  for (let index = 0; index < 48; index++) {
    const y = 1 - (index / 47) * 2
    const ring = Math.sqrt(Math.max(0, 1 - y * y))
    const radius = .45 + (index % 4) * .22
    const candidate = intent.clone().add(new Vector3(Math.cos(index * goldenAngle) * ring, y, Math.sin(index * goldenAngle) * ring).multiplyScalar(radius))
    const score = nearestDistance(candidate) - radius * .18
    if (score > bestScore) { best = candidate; bestScore = score }
  }
  return [best.x, best.y, best.z]
}

export function relaxLayout(nodes: WordNode[]): WordNode[] {
  if (nodes.length < 2) return nodes
  const points = nodes.map(node => new Vector3(...node.position))
  const minimumDistance = 1.9
  for (let step = 0; step < 18; step++) {
    const center = points.reduce((sum, point) => sum.add(point), new Vector3()).multiplyScalar(1 / points.length)
    const buckets = new Map<string, number[]>()
    points.forEach((point, index) => {
      const key = `${Math.floor(point.x / minimumDistance)}:${Math.floor(point.y / minimumDistance)}:${Math.floor(point.z / minimumDistance)}`
      const bucket = buckets.get(key)
      if (bucket) bucket.push(index); else buckets.set(key, [index])
    })
    points.forEach((point, i) => {
      if (nodes[i].positionLocked) return
      const shift = new Vector3()
      const cellX = Math.floor(point.x / minimumDistance), cellY = Math.floor(point.y / minimumDistance), cellZ = Math.floor(point.z / minimumDistance)
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
        const nearby = buckets.get(`${cellX + x}:${cellY + y}:${cellZ + z}`) || []
        nearby.forEach(j => {
          if (i === j) return
          const other = points[j]
          const dx = point.x - other.x, dy = point.y - other.y, dz = point.z - other.z
          const rawDistance = Math.sqrt(dx * dx + dy * dy + dz * dz)
          if (rawDistance >= minimumDistance) return
          const strength = (minimumDistance - rawDistance) * .045
          if (rawDistance < .0001) shift.add(deterministicDirection(nodes[i].id, nodes[j].id).multiplyScalar(strength))
          else shift.add(new Vector3(dx / rawDistance, dy / rawDistance, dz / rawDistance).multiplyScalar(strength))
        })
      }
      const fromCenter = point.clone().sub(center)
      if (fromCenter.length() > 5.2) shift.add(fromCenter.normalize().multiplyScalar(-.025))
      point.add(shift)
    })
  }
  return nodes.map((node, i) => ({ ...node, position: [points[i].x, points[i].y, points[i].z] }))
}
