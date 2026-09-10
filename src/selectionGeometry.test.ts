import { describe, expect, it } from 'vitest'
import { segmentHitsBox, segmentHitsPolygon, segmentsIntersect } from './selectionGeometry'

describe('screen-space relation selection', () => {
  it('selects a relation crossing a box even when both endpoints are outside', () => {
    expect(segmentHitsBox({ x: -5, y: 5 }, { x: 15, y: 5 }, 0, 10, 0, 10)).toBe(true)
  })

  it('does not select distant collinear segments', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 8, y: 0 }, { x: 10, y: 0 })).toBe(false)
    expect(segmentHitsBox({ x: 20, y: 20 }, { x: 30, y: 30 }, 0, 10, 0, 10)).toBe(false)
  })

  it('selects relations crossing or contained by a lasso polygon', () => {
    const polygon = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    expect(segmentHitsPolygon({ x: -4, y: 5 }, { x: 14, y: 5 }, polygon)).toBe(true)
    expect(segmentHitsPolygon({ x: 3, y: 3 }, { x: 7, y: 7 }, polygon)).toBe(true)
    expect(segmentHitsPolygon({ x: 14, y: 14 }, { x: 20, y: 20 }, polygon)).toBe(false)
  })
})