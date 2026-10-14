import { useRef } from 'react'
import { isImeComposing } from './shortcuts'

// Keep the native composition buffer in the DOM, without round-tripping
// each keystroke through the separate React Three Fiber / Html roots.
export function SceneRenameInput({ label, onRename }: { label: string; onRename: (label: string | null) => void }) {
  const composing = useRef(false)
  const finished = useRef(false)
  const finish = (value: string | null) => {
    if (finished.current) return
    finished.current = true
    onRename(value)
  }
  return <input className="scene-rename" autoFocus defaultValue={label}
    aria-label="词眼名称"
    onFocus={event => event.currentTarget.select()}
    onCompositionStart={() => { composing.current = true }}
    onCompositionEnd={event => {
      composing.current = false
      const input = event.currentTarget
      // Wait for the final native input event before committing a blurred field.
      queueMicrotask(() => {
        if (input.isConnected && document.activeElement !== input) finish(input.value)
      })
    }}
    onPointerDown={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation()
      if (composing.current || isImeComposing(event.nativeEvent)) return
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault()
        finish(event.key === 'Enter' ? event.currentTarget.value : null)
      }
    }}
    onBlur={event => { if (!composing.current) finish(event.currentTarget.value) }}/>
}
