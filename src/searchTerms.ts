export function parseSearchTerms(query: string): string[] {
  return query
    .split(/[,，]/)
    .map(term => term.trim().toLocaleLowerCase())
    .filter(Boolean)
}