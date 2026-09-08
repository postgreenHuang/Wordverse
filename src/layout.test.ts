import { describe, expect, it } from 'vitest'
import { balancedPosition, boundedIntentPosition, nearbyIntentPosition, relaxLayout } from './layout'
import type { WordNode } from './types'

const word = (id: string, position: [number, number, number] = [0, 0, 0], positionLocked = false): WordNode => ({ id, label: id, note: '', tags: [], links: [], position, scale: 1, positionLocked })

describe('compact three-dimensional layout', () => {
  it('chooses bounded positions with depth instead of appending on a plane', () => {
    let nodes: WordNode[] = []
    for (let index = 0; index < 40; index++) {
      nodes = relaxLayout([...nodes, word(String(index), balancedPosition(nodes))])
    }
    const axes = [0, 1, 2].map(axis => Math.max(...nodes.map(node => node.position[axis])) - Math.min(...nodes.map(node => node.position[axis])))
    expect(axes.every(span => span > 1)).toBe(true)
    expect(Math.max(...nodes.flatMap(node => node.position.map(Math.abs)))).toBeLessThan(9)
  })

  it('separates exactly overlapping imported words deterministically', () => {
    const source = Array.from({ length: 12 }, (_, index) => word(`word-${index}`))
    const first = relaxLayout(source)
    const second = relaxLayout(source)
    expect(first.map(node => node.position)).toEqual(second.map(node => node.position))
    expect(new Set(first.map(node => node.position.map(value => value.toFixed(4)).join(':'))).size).toBe(source.length)
  })

  it('never moves locked spatial anchors', () => {
    const locked = word('anchor', [1, 2, 3], true)
    const result = relaxLayout([locked, word('overlap', [1, 2, 3])])
    expect(result[0].position).toEqual([1, 2, 3])
    expect(result[1].position).not.toEqual([1, 2, 3])
  })

  it('keeps a distant double-click intent inside the compact graph volume', () => {
    const nodes = [word('a', [-1, 0, 0]), word('b', [1, 0, 0])]
    const result = boundedIntentPosition(nodes, [1000, 200, -900])
    expect(Math.hypot(...result)).toBeLessThanOrEqual(4.01)
    expect(result[0]).toBeGreaterThan(0)
    expect(result[1]).toBeGreaterThan(0)
    expect(result[2]).toBeLessThan(0)
  })

  it('keeps double-click creation near the pointer while avoiding an overlap', () => {
    const requested: [number, number, number] = [5, 3, -4]
    const result = nearbyIntentPosition([word('occupied', requested)], requested)
    expect(Math.hypot(result[0] - requested[0], result[1] - requested[1], result[2] - requested[2])).toBeLessThanOrEqual(1.12)
    expect(result).not.toEqual(requested)
  })

  it('relaxes a large graph within an interactive-time budget', () => {
    const nodes = Array.from({ length: 600 }, (_, index) => {
      const angle = index * Math.PI * (3 - Math.sqrt(5))
      return word(`large-${index}`, [Math.cos(angle) * (index % 9) * .31, ((index * 7) % 17 - 8) * .22, Math.sin(angle) * (index % 11) * .27])
    })
    const started = performance.now()
    const result = relaxLayout(nodes)
    expect(result).toHaveLength(600)
    expect(result.every(node => node.position.every(Number.isFinite))).toBe(true)
    expect(performance.now() - started).toBeLessThan(750)
  })
})
