import { describe, expect, it } from 'vitest'
import { insertTabAtSelection } from './textEditing'

describe('insertTabAtSelection', () => {
  it('inserts an indent at the caret', () => {
    expect(insertTabAtSelection('前后', 1, 1)).toEqual({ value: '前  后', cursor: 3 })
  })

  it('replaces the active selection with an indent', () => {
    expect(insertTabAtSelection('abcdef', 2, 5, '\t')).toEqual({ value: 'ab\tf', cursor: 3 })
  })

  it('clamps stale selection offsets', () => {
    expect(insertTabAtSelection('词', 9, 12)).toEqual({ value: '词  ', cursor: 3 })
  })
})