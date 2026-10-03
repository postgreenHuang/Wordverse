export type ShortcutEvent = {
  altKey: boolean
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  isComposing?: boolean
  keyCode?: number
}

export function shortcutForEvent(event: ShortcutEvent): string {
  const modifiers = [event.ctrlKey || event.metaKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean)
  return [...modifiers, event.code].join('+')
}

export function matchesShortcut(event: ShortcutEvent, binding: string): boolean {
  return shortcutForEvent(event) === binding
}

export function matchesRemovalShortcut(event: ShortcutEvent, binding: string): boolean {
  if (matchesShortcut(event, binding)) return true
  return binding === 'Delete'
    && !event.ctrlKey
    && !event.metaKey
    && !event.altKey
    && !event.shiftKey
    && event.code === 'Backspace'
}

export function isImeComposing(event: object): boolean {
  const composition = event as Pick<ShortcutEvent, 'isComposing' | 'keyCode'>
  return composition.isComposing === true || composition.keyCode === 229
}

export function shouldRemoveSelection(event: ShortcutEvent, binding: string, textEditing: boolean): boolean {
  return !textEditing && !isImeComposing(event) && matchesRemovalShortcut(event, binding)
}