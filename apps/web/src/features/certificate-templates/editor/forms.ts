import type { PlaceholderCatalogEntry } from '../types'
import { LOCKED_BLOCK_LABELS } from './editor-sample-data'

/**
 * Pure, testable logic for the editor's placeholder UX (schema-first rule:
 * parsing/derivation lives here, not in JSX handlers).
 */

export type GroupedCatalog = Array<{
  group: string
  entries: PlaceholderCatalogEntry[]
}>

/** Case/diacritic-insensitive catalog search over label + path, grouped. */
export function filterCatalog(
  entries: PlaceholderCatalogEntry[],
  query: string,
): GroupedCatalog {
  const normalizedQuery = normalize(query)
  const matches = normalizedQuery
    ? entries.filter(
        (entry) =>
          normalize(entry.label).includes(normalizedQuery) ||
          normalize(entry.path).includes(normalizedQuery),
      )
    : entries
  const groups = new Map<string, PlaceholderCatalogEntry[]>()
  for (const entry of matches) {
    const bucket = groups.get(entry.group)
    if (bucket) bucket.push(entry)
    else groups.set(entry.group, [entry])
  }
  return [...groups.entries()].map(([group, grouped]) => ({
    group,
    entries: grouped,
  }))
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export type ValidationIssue = { path: string; message: string }

/**
 * Server validation issues carry Zod paths like "content.17.content.1.attrs".
 * Extract the TOP-LEVEL block index so the UI can point at the offending block.
 */
export function issueBlockIndex(issuePath: string): number | null {
  const match = /^content\.(\d+)/.exec(issuePath)
  if (!match?.[1]) return null
  const index = Number.parseInt(match[1], 10)
  return Number.isFinite(index) ? index : null
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  paragraph: 'Parágrafo',
  heading: 'Título',
  bulletList: 'Lista',
  orderedList: 'Lista numerada',
  table: 'Tabela',
  image: 'Imagem',
  horizontalRule: 'Divisor',
  pageHeader: 'Cabeçalho',
  pageFooter: 'Rodapé',
  lockedBlock: 'Bloco obrigatório',
}

/** Human label for the block an issue points at ("Bloco 3 — Parágrafo"). */
export function describeIssueLocation(
  documentJson: Record<string, unknown>,
  issuePath: string,
): string | null {
  const index = issueBlockIndex(issuePath)
  if (index === null) return null
  const content = Reflect.get(documentJson, 'content')
  if (!Array.isArray(content)) return `Bloco ${index + 1}`
  const block = content[index]
  const type =
    block && typeof block === 'object' ? String(Reflect.get(block, 'type')) : ''
  if (type === 'lockedBlock' && block && typeof block === 'object') {
    const attrs = Reflect.get(block, 'attrs')
    const blockKey =
      attrs && typeof attrs === 'object'
        ? String(Reflect.get(attrs, 'blockKey') ?? '')
        : ''
    const label = LOCKED_BLOCK_LABELS[blockKey]
    if (label) return `Bloco ${index + 1} — ${label}`
  }
  return `Bloco ${index + 1} — ${BLOCK_TYPE_LABELS[type] ?? type}`
}

/** Normalize a validationResult jsonb (or a validate-document response) into issues. */
export function parseValidationIssues(value: unknown): ValidationIssue[] {
  if (!value || typeof value !== 'object') return []
  const rawIssues = Reflect.get(value, 'issues')
  if (!Array.isArray(rawIssues)) return []
  return rawIssues.flatMap((issue) => {
    if (!issue || typeof issue !== 'object') return []
    const path = Reflect.get(issue, 'path')
    const message = Reflect.get(issue, 'message')
    return typeof message === 'string'
      ? [{ path: typeof path === 'string' ? path : '', message }]
      : []
  })
}
