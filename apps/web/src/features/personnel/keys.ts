/** Query keys of the personnel (competences and training) feature. See `assets/keys.ts`. */
export type CompetenceListKeyInput = {
  organizationId: string
  page: number
  statusFilter: string
}

export const competenceKeys = {
  all: ['competences'] as const,
  list: (input: CompetenceListKeyInput) =>
    [
      'competences',
      input.organizationId,
      input.page,
      input.statusFilter,
    ] as const,
  listScope: (organizationId: string) =>
    ['competences', organizationId] as const,
  matrix: (organizationId: string) =>
    ['competences-matrix', organizationId] as const,
  /** The matrix of every organization. */
  matrices: ['competences-matrix'] as const,
  detail: (id: string | number) => ['competence', id] as const,
  label: (id: string | number) => ['competence', id, 'label'] as const,
  audit: (id: string | number) => ['competence-audit', id] as const,
}

export const trainingRecordKeys = {
  all: ['training-records'] as const,
  assignable: (userId: string) =>
    ['training-records', 'assignable', userId] as const,
}
