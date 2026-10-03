import { describe, expect, it } from 'vitest'
import { isImeComposing, matchesRemovalShortcut, shortcutForEvent, shouldRemoveSelection } from './shortcuts'

const key = (code: string, extra: Partial<Parameters<typeof shortcutForEvent>[0]> = {}) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
})

describe('cross-platform shortcuts', () => {
  it('treats macOS Backspace as the default Delete binding', () => {
    expect(matchesRemovalShortcut(key('Backspace'), 'Delete')).toBe(true)
    expect(matchesRemovalShortcut(key('Delete'), 'Delete')).toBe(true)
    expect(matchesRemovalShortcut(key('Backspace', { metaKey: true }), 'Delete')).toBe(false)
  })

  it('does not override a custom removal binding', () => {
    expect(matchesRemovalShortcut(key('Backspace'), 'KeyK')).toBe(false)
    expect(matchesRemovalShortcut(key('KeyK'), 'KeyK')).toBe(true)
  })

  it('never removes a node while a text field is editing', () => {
    expect(shouldRemoveSelection(key('Backspace'), 'Delete', true)).toBe(false)
    expect(shouldRemoveSelection(key('Backspace'), 'Delete', false)).toBe(true)
    expect(shouldRemoveSelection(key('Backspace', { isComposing: true }), 'Delete', false)).toBe(false)
  })

  it('recognizes browser and legacy IME composition signals', () => {
    expect(isImeComposing({ isComposing: true })).toBe(true)
    expect(isImeComposing({ keyCode: 229 })).toBe(true)
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false)
  })
})