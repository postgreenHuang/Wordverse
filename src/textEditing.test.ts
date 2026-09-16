import { describe, expect, it } from 'vitest'
import { insertTabAtSelection, parseMarkdownBlocks } from './textEditing'

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
describe('parseMarkdownBlocks', () => {
  it('parses a pipe table and preserves surrounding text', () => {
    expect(parseMarkdownBlocks('说明\n\n| 名称 | 工具 |\n| --- | --- |\n| Main | Profiler |\n结尾')).toEqual([
      { type: 'text', value: '说明\n' },
      { type: 'table', header: ['名称', '工具'], rows: [['Main', 'Profiler']] },
      { type: 'text', value: '结尾' },
    ])
  })

  it('keeps non-table pipes as ordinary text', () => {
    expect(parseMarkdownBlocks('A | B\n不是分隔线')).toEqual([{ type: 'text', value: 'A | B\n不是分隔线' }])
  })
})
