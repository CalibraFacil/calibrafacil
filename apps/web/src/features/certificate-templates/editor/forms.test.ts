import { describe, expect, it } from 'vitest'

import type { PlaceholderCatalogEntry } from '../types'
import {
  describeIssueLocation,
  filterCatalog,
  issueBlockIndex,
  parseValidationIssues,
} from './forms'

const entry = (
  path: string,
  label: string,
  group: string,
): PlaceholderCatalogEntry => ({
  path,
  label,
  group,
  type: 'text',
  source: 'x',
  required: false,
  format: 'text',
})

const CATALOG = [
  entry('customer.name', 'Razão social do cliente', 'Cliente'),
  entry('uncertainty.expanded.value', 'Incerteza expandida (U)', 'Incerteza'),
  entry('asset.tag', 'TAG do item', 'Item'),
]

describe('filterCatalog', () => {
  it('groups all entries when the query is empty', () => {
    const grouped = filterCatalog(CATALOG, '')
    expect(grouped.map((g) => g.group)).toEqual([
      'Cliente',
      'Incerteza',
      'Item',
    ])
  })

  it('matches diacritic-insensitively on label and path', () => {
    expect(filterCatalog(CATALOG, 'razao')[0]?.entries[0]?.path).toBe(
      'customer.name',
    )
    expect(filterCatalog(CATALOG, 'expanded.va')[0]?.entries[0]?.path).toBe(
      'uncertainty.expanded.value',
    )
    expect(filterCatalog(CATALOG, 'nada disso')).toEqual([])
  })
})

describe('issue mapping', () => {
  it('extracts the top-level block index from Zod paths', () => {
    expect(issueBlockIndex('content.17.content.1.attrs')).toBe(17)
    expect(issueBlockIndex('content.0')).toBe(0)
    expect(issueBlockIndex('placeholders')).toBeNull()
  })

  it('describes the offending block from the document', () => {
    const documentJson = {
      type: 'doc',
      content: [
        { type: 'heading' },
        { type: 'lockedBlock', attrs: { blockKey: 'results_table' } },
        { type: 'paragraph' },
      ],
    }
    expect(describeIssueLocation(documentJson, 'content.2.content.0')).toBe(
      'Bloco 3 — Parágrafo',
    )
    expect(describeIssueLocation(documentJson, 'content.1')).toBe(
      'Bloco 2 — Bloco obrigatório',
    )
    expect(describeIssueLocation(documentJson, 'compile')).toBeNull()
  })
})

describe('parseValidationIssues', () => {
  it('normalizes persisted validationResult shapes', () => {
    expect(
      parseValidationIssues({
        ok: false,
        issues: [
          { path: 'content.1', message: 'faltou bloco' },
          { message: 'solto' },
        ],
      }),
    ).toEqual([
      { path: 'content.1', message: 'faltou bloco' },
      { path: '', message: 'solto' },
    ])
    expect(parseValidationIssues(null)).toEqual([])
    expect(parseValidationIssues({ ok: true })).toEqual([])
  })
})
