export function insertTabAtSelection(value: string, start: number, end: number, indent = '  '): { value: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(start, value.length))
  const safeEnd = Math.max(safeStart, Math.min(end, value.length))
  return {
    value: `${value.slice(0, safeStart)}${indent}${value.slice(safeEnd)}`,
    cursor: safeStart + indent.length,
  }
}
export type MarkdownBlock =
  | { type: 'text'; value: string }
  | { type: 'table'; header: string[]; rows: string[][] }

function tableCells(line: string): string[] {
  const trimmed = line.trim()
  const withoutEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  return withoutEdges.split('|').map(cell => cell.trim())
}

function isTableDivider(line: string): boolean {
  const cells = tableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

export function parseMarkdownBlocks(value: string): MarkdownBlock[] {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let textLines: string[] = []
  const flushText = () => {
    if (!textLines.length) return
    blocks.push({ type: 'text', value: textLines.join('\n') })
    textLines = []
  }
  for (let index = 0; index < lines.length;) {
    const header = tableCells(lines[index])
    if (index + 1 < lines.length && lines[index].includes('|') && isTableDivider(lines[index + 1])) {
      flushText()
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        const cells = tableCells(lines[index])
        rows.push([...cells, ...Array(Math.max(0, header.length - cells.length)).fill('')].slice(0, header.length))
        index += 1
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }
    textLines.push(lines[index])
    index += 1
  }
  flushText()
  return blocks
}