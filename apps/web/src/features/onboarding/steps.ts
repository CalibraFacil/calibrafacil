import type {
  ActivationChecklistResponse,
  ActivationStepId,
} from '@calibra-facil/client-runtime'

/**
 * The six things a laboratory does before it can issue its first certificate.
 *
 * Presented as a checklist rather than a wizard: these steps have almost no
 * real dependencies on each other, and the one that most often stalls, the
 * ICP-Brasil A1 certificate, frequently belongs to someone other than whoever
 * is doing the setup. A wizard would block the whole sequence on a step waiting
 * for a colleague; a checklist lets the rest continue.
 *
 * Each step links into the screen that already exists for it, carrying an
 * `onboarding` search param so the destination can point at the right control
 * instead of leaving the lab to find it.
 */

export type ActivationStep = {
  id: ActivationStepId
  label: string
  /** One line, in the laboratory's own vocabulary. No talking down. */
  help: string
  to: string
  /** Steps that must be done first. Empty for everything but the last. */
  requires: ActivationStepId[]
}

export const ACTIVATION_STEPS: ActivationStep[] = [
  {
    id: 'organizationProfile',
    label: 'Completar os dados do laboratório',
    help: 'Razão social, CNPJ, contato e cidade saem impressos no certificado.',
    to: '/dashboard/settings/organization',
    requires: [],
  },
  {
    id: 'methodPublished',
    label: 'Publicar um método de calibração',
    help: 'Adote um método do catálogo e resolva os itens marcados [VERIFICAR] antes de publicar.',
    to: '/dashboard/methods',
    requires: [],
  },
  {
    id: 'referenceStandard',
    label: 'Cadastrar o padrão de referência',
    help: 'Só o padrão que a sua primeira calibração vai usar. Os demais podem entrar depois.',
    to: '/dashboard/standards',
    requires: [],
  },
  {
    id: 'signingCertificate',
    label: 'Enviar o certificado ICP-Brasil A1',
    help: 'É o que assina o laudo. Os dados do titular e a validade são lidos do próprio arquivo.',
    to: '/dashboard/settings/certificates',
    requires: [],
  },
  {
    id: 'customer',
    label: 'Cadastrar o primeiro cliente',
    help: 'O CNPJ preenche razão social, endereço e contato.',
    to: '/dashboard/clients',
    requires: [],
  },
  {
    id: 'firstCertificate',
    label: 'Emitir a primeira calibração',
    help: 'Abra a ordem de serviço, execute a calibração e libere o laudo assinado.',
    to: '/dashboard/jobs',
    requires: ['methodPublished', 'referenceStandard', 'signingCertificate'],
  },
]

export type ActivationStepView = ActivationStep & {
  done: boolean
  /** Prerequisites are still open, so the step cannot be started yet. */
  locked: boolean
  /** Labels of the steps that must come first, for the locked explanation. */
  blockedBy: string[]
  href: string
}

export type ActivationChecklistView = {
  steps: ActivationStepView[]
  /** What is still open, reachable steps first and blocked ones after. */
  remaining: ActivationStepView[]
  /** What is already done, in the canonical order. */
  completed: ActivationStepView[]
  completedCount: number
  totalCount: number
  /** Hidden entirely once the laboratory has issued a certificate. */
  complete: boolean
}

/**
 * Turn the server's derived booleans into what the panel renders.
 *
 * A locked step is not a failure state and never reads as one: it is simply not
 * yet reachable, and it says which step comes first.
 */
export function buildActivationChecklistView(
  checklist: ActivationChecklistResponse,
): ActivationChecklistView {
  const doneById = new Map(
    checklist.steps.map((step) => [step.id, step.done] as const),
  )
  const labelById = new Map(
    ACTIVATION_STEPS.map((step) => [step.id, step.label] as const),
  )

  const steps = ACTIVATION_STEPS.map((step) => {
    const blockedBy = step.requires
      .filter((requirement) => doneById.get(requirement) !== true)
      .map((requirement) => labelById.get(requirement) ?? requirement)

    return {
      ...step,
      done: doneById.get(step.id) === true,
      locked: blockedBy.length > 0,
      blockedBy,
      href: `${step.to}?onboarding=${step.id}`,
    }
  })

  // Split rather than one flat list: what is left is the only part anyone
  // acts on, so it goes first and at full weight, and the steps that are
  // already behind the laboratory become a quiet ledger underneath. Within
  // each group the canonical order is preserved.
  const open = steps.filter((step) => !step.done)
  const completed = steps.filter((step) => step.done)

  return {
    steps,
    remaining: [
      ...open.filter((step) => !step.locked),
      ...open.filter((step) => step.locked),
    ],
    completed,
    completedCount: completed.length,
    totalCount: steps.length,
    complete: checklist.complete,
  }
}
