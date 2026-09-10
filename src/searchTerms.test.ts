import { describe, expect, it } from 'vitest'
import { parseSearchTerms } from './searchTerms'

describe('parseSearchTerms', () => {
  it('splits keywords with Chinese and English commas', () => {
    expect(parseSearchTerms('记忆，学习, 语境')).toEqual(['记忆', '学习', '语境'])
  })

  it('preserves spaces inside a keyword', () => {
    expect(parseSearchTerms('machine learning, spaced repetition')).toEqual(['machine learning', 'spaced repetition'])
  })

  it('ignores blank comma-separated entries', () => {
    expect(parseSearchTerms(' 记忆，,，关系 ')).toEqual(['记忆', '关系'])
  })
})