/**
 * Search schema for the from-template wizard.
 *
 * REQ-FTPL-001: step defaults to 'catalog' when absent.
 * REQ-FTPL-002: unknown step values resolve to 'catalog' without throwing.
 */
export type FromTemplateStep = 'catalog' | 'context' | 'confirm'

export type FromTemplateSearch = {
  step?: FromTemplateStep
  template?: string
}

export function parseFromTemplateSearch(
  input: Record<string, unknown>,
): FromTemplateSearch {
  const rawStep = input.step
  const step: FromTemplateStep | undefined =
    rawStep === 'context'
      ? 'context'
      : rawStep === 'confirm'
        ? 'confirm'
        : rawStep === 'catalog'
          ? 'catalog'
          : undefined

  const template =
    typeof input.template === 'string' && input.template.length > 0
      ? input.template
      : undefined

  return { step, template }
}
