export function insertTabAtSelection(value: string, start: number, end: number, indent = '  '): { value: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(start, value.length))
  const safeEnd = Math.max(safeStart, Math.min(end, value.length))
  return {
    value: `${value.slice(0, safeStart)}${indent}${value.slice(safeEnd)}`,
    cursor: safeStart + indent.length,
  }
}