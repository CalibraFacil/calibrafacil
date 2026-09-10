import { useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import type {
  MethodFromTemplateInput,
  MethodTemplateCatalogEntry,
} from '@calibra-facil/client-runtime'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ACTION_BUTTON_CLASS,
  BlueprintField,
  BlueprintGrid,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { assetTypesQueryOptions } from '@/features/assets/queries'

import { useMethodTemplatesData } from './queries'
import {
  disciplineLabel,
  parseTemplateSpec,
  shortSourceSigla,
} from './template-spec'
import { MethodSpecPreview } from './components/method-spec-preview'
import { TemplateGovernancePanel } from './components/template-governance-panel'
import {
  WizardStepper,
  type FromTemplateStepKey,
} from './components/wizard-stepper'
import type { FromTemplateSearch } from './from-template-search'

/**
 * "Criar método a partir de modelo" — the 3-step adoption wizard.
 *
 * Compliance (design §3): catalog cards have NO adopt affordance (only "Revisar
 * contexto"), so adoption is only reachable THROUGH the mandatory context screen;
 * adoption creates a DRAFT (never published, never accredited); the three
 * acknowledgements are required and recorded; acknowledging is explicitly NOT the
 * lab's §7.2.1.5 verification.
 *
 * The active step and the selected template are derived from the `search` prop
 * (URL search params), NOT from local state. Transitions call `navigate` so
 * browser-back walks the wizard steps (REQ-FTPL-004).
 */
export function FromTemplatePage({ search }: { search: FromTemplateSearch }) {
  const navigate = useNavigate()
  const { data: templates, isLoading, error } = useMethodTemplatesData()

  // Derive the active step from search param. Default to 'catalog'.
  // REQ-FTPL-001 / REQ-FTPL-002: absent or unknown → 'catalog'.
  const rawStep = search.step
  const templateParam = search.template ?? null

  // REQ-FTPL-005: if step is context/confirm but template is missing or
  // doesn't match a loaded template, fall back to catalog.
  const selected =
    templates?.find((entry) => entry.templateKey === templateParam) ?? null

  const step: FromTemplateStepKey =
    rawStep === 'context' || rawStep === 'confirm'
      ? selected !== null
        ? rawStep
        : 'catalog'
      : 'catalog'

  const { data: assetTypesData } = useQuery(assetTypesQueryOptions())
  const assetTypes = assetTypesData?.data ?? []

  // Derived (NO useEffect): the slug default + the user's optional override.
  const slugResolvedAssetTypeId =
    assetTypes.find((type) => type.slug === selected?.assetTypeSlug)?.id ?? null

  // Navigate forward — push a new history entry (REQ-FTPL-004 requires push,
  // not replace, so that browser-back returns to the previous step).
  const goToStep = (
    newStep: FromTemplateStepKey,
    templateKey?: string | null,
  ) => {
    navigate({
      to: '/dashboard/methods/from-template',
      search:
        newStep === 'catalog'
          ? {}
          : { step: newStep, template: templateKey ?? templateParam ?? '' },
    })
  }

  // REQ-FTPL-003: clicking "Revisar contexto" navigates to context step.
  const openContext = (entry: MethodTemplateCatalogEntry) => {
    navigate({
      to: '/dashboard/methods/from-template',
      search: { step: 'context', template: entry.templateKey },
    })
  }

  // REQ-FTPL-006: stepper step-select navigates to that step's search params.
  const handleStepSelect = (clickedStep: FromTemplateStepKey) => {
    if (clickedStep === 'catalog') {
      navigate({
        to: '/dashboard/methods/from-template',
        search: {},
      })
    } else {
      navigate({
        to: '/dashboard/methods/from-template',
        search: { step: clickedStep, template: templateParam ?? '' },
      })
    }
  }

  const adopt = useMutation({
    mutationFn: (input: MethodFromTemplateInput) =>
      calibraApi.methods.fromTemplate(input),
    onSuccess: (method) => {
      toast.success('Rascunho criado a partir do modelo — pendente de revisão')
      navigate({
        to: '/dashboard/methods/$id',
        params: { id: String(method.id) },
      })
    },
    onError: (mutationError) =>
      toast.error(
        mutationError instanceof Error
          ? mutationError.message
          : 'Falha ao criar o método',
      ),
  })

  return (
    <div className="space-y-6">
      <Panel className="p-5 sm:p-6">
        <PanelHeader
          title="Novo método a partir de modelo"
          description="Modelos curados, fundamentados em guias publicados. Cada modelo entra como RASCUNHO e exige a verificação do seu laboratório antes do uso."
        />
        <div className="mt-4">
          {/* REQ-FTPL-006: completed steps are clickable via handleStepSelect */}
          <WizardStepper current={step} onStepSelect={handleStepSelect} />
        </div>
      </Panel>

      {step === 'catalog' ? (
        <CatalogStep
          templates={templates}
          isLoading={isLoading}
          hasError={Boolean(error)}
          onReview={openContext}
        />
      ) : null}

      {step === 'context' && selected ? (
        <ContextStep
          entry={selected}
          onBack={() => goToStep('catalog')}
          onConfirm={() => goToStep('confirm')}
        />
      ) : null}

      {step === 'confirm' && selected ? (
        <ConfirmStep
          key={selected.templateKey}
          entry={selected}
          assetTypes={assetTypes}
          slugResolvedAssetTypeId={slugResolvedAssetTypeId}
          isPending={adopt.isPending}
          onBack={() => goToStep('context')}
          onSubmit={(payload) => adopt.mutate(payload)}
        />
      ) : null}
    </div>
  )
}

/**
 * REQ-FTPL-007: ConfirmStep is a separate component that receives `key` from
 * the parent (keyed by templateKey). On re-mount the ack checkboxes are
 * derived from fresh local state — no `useEffect` needed.
 */
function ConfirmStep({
  entry,
  assetTypes,
  slugResolvedAssetTypeId,
  isPending,
  onBack,
  onSubmit,
}: {
  entry: MethodTemplateCatalogEntry
  assetTypes: { id: number; slug: string | null; name: string }[]
  slugResolvedAssetTypeId: number | null
  isPending: boolean
  onBack: () => void
  onSubmit: (payload: MethodFromTemplateInput) => void
}) {
  const [name, setName] = useState(entry.defaultName)
  const [ackRead, setAckRead] = useState(false)
  const [ackDuty, setAckDuty] = useState(false)
  const [ackDraft, setAckDraft] = useState(false)
  const [assetTypeChoice, setAssetTypeChoice] = useState<number | null>(null)

  const effectiveAssetTypeId = assetTypeChoice ?? slugResolvedAssetTypeId

  // Derived gate — NO useEffect.
  const canSubmit =
    ackRead && ackDuty && ackDraft && name.trim().length >= 2 && !isPending

  const submit = () => {
    if (!canSubmit) return
    const acceptedVerificarRefs = entry.governance.verificarItems
      .filter((item) => item.severity === 'action')
      .map((item) => item.ref)
      .filter((ref): ref is string => typeof ref === 'string')
    onSubmit({
      templateKey: entry.templateKey,
      name: name.trim(),
      assetTypeId: effectiveAssetTypeId,
      acknowledgements: {
        readVerificarAndOmitted: true,
        acceptsVerificationDuty: true,
        understandsDraftGate: true,
        acknowledgedAt: new Date().toISOString(),
        templateVersion: entry.templateVersion,
        acceptedVerificarRefs,
      },
    })
  }

  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader title={`Adotar: ${entry.defaultName}`} />
      <div className="mt-4 space-y-5">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Configuração
          </p>
          <label className="block">
            <span className="text-sm font-medium">Nome do método</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1"
              aria-label="Nome do método"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Tipo de equipamento</span>
            <Select
              value={
                effectiveAssetTypeId != null
                  ? String(effectiveAssetTypeId)
                  : undefined
              }
              onValueChange={(value) => setAssetTypeChoice(Number(value))}
            >
              <SelectTrigger className="mt-1" aria-label="Tipo de equipamento">
                <SelectValue placeholder="Selecione o tipo de equipamento" />
              </SelectTrigger>
              <SelectContent>
                {assetTypes.map((type) => (
                  <SelectItem key={type.id} value={String(type.id)}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="mt-1 block text-xs text-muted-foreground">
              Padrão do modelo:{' '}
              <span className="font-medium">
                {assetTypes.find((type) => type.id === slugResolvedAssetTypeId)
                  ?.name ??
                  entry.assetTypeSlug ??
                  '—'}
              </span>
              . Ajuste se este método se aplica a outro tipo.
            </span>
          </label>
        </div>

        <fieldset className="space-y-3 rounded-xl bg-muted/40 p-4 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
          <legend className="px-1 text-sm font-medium">
            Reconhecimentos (registrados na trilha de auditoria)
          </legend>
          <AckRow checked={ackRead} onChange={setAckRead}>
            Li os itens [VERIFICAR] e os componentes situacionais deste modelo.
          </AckRow>
          <AckRow checked={ackDuty} onChange={setAckDuty}>
            Assumo o dever do meu laboratório de VERIFICAR e VALIDAR este método
            antes de usá-lo.{' '}
            <span className="font-medium text-foreground">
              reconheço que marcar estas caixas NÃO constitui essa verificação.
            </span>
          </AckRow>
          <AckRow checked={ackDraft} onChange={setAckDraft}>
            Entendo que isto cria um RASCUNHO; o método não calibra até passar
            por Revisão técnica e Aprovação da qualidade (Publicado).
          </AckRow>
        </fieldset>

        <p className="text-xs text-muted-foreground">
          Após criar, você irá para o rascunho para "Solicitar aprovação".
        </p>

        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" onClick={onBack}>
            ← Voltar
          </Button>
          <Button
            className={cn(ACTION_BUTTON_CLASS)}
            disabled={!canSubmit}
            onClick={submit}
          >
            {isPending ? 'Criando…' : 'Criar rascunho'}
          </Button>
        </div>
      </div>
    </Panel>
  )
}

function CatalogStep({
  templates,
  isLoading,
  hasError,
  onReview,
}: {
  templates: MethodTemplateCatalogEntry[] | undefined
  isLoading: boolean
  hasError: boolean
  onReview: (entry: MethodTemplateCatalogEntry) => void
}) {
  if (isLoading) {
    return (
      <StaggerGroup className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_unused, index) => (
          <StaggerItem key={index}>
            <Panel className="space-y-3 p-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-7 w-full rounded-lg" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-9 w-full rounded-md" />
            </Panel>
          </StaggerItem>
        ))}
      </StaggerGroup>
    )
  }
  if (hasError) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm font-medium">Falha ao carregar os modelos</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Não foi possível carregar o catálogo de modelos. Atualize a página
          para tentar novamente.
        </p>
      </Panel>
    )
  }
  if (!templates || templates.length === 0) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm font-medium">Nenhum modelo disponível</p>
        <p className="mt-1 text-pretty text-sm text-muted-foreground">
          Só aparecem aqui os modelos com contexto metrológico completo. Volte
          em breve — o catálogo cresce conforme novos modelos são validados.
        </p>
      </Panel>
    )
  }

  return (
    <div className="space-y-4">
      {/* One responsive grid across all templates: each discipline currently has
          a single template, so a per-discipline grid would strand a lone card in
          a 3-column row. Cards carry their own discipline label instead. */}
      <StaggerGroup className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {templates.map((entry) => (
          <StaggerItem key={entry.templateKey}>
            <TemplateCard entry={entry} onReview={onReview} />
          </StaggerItem>
        ))}
      </StaggerGroup>
      <p className="text-center text-xs text-muted-foreground">
        Todos os modelos entram como{' '}
        <span className="font-medium">Rascunho · Não acreditado</span> e exigem
        a verificação do seu laboratório antes do uso.
      </p>
    </div>
  )
}

function TemplateCard({
  entry,
  onReview,
}: {
  entry: MethodTemplateCatalogEntry
  onReview: (entry: MethodTemplateCatalogEntry) => void
}) {
  const sources = entry.governance.sources
  return (
    <Panel className="flex h-full flex-col p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-medium">{entry.defaultName}</h3>
        <Badge variant="outline" className="shrink-0">
          {disciplineLabel(entry.discipline)}
        </Badge>
      </div>

      <div className="mt-2 overflow-x-auto rounded-lg bg-muted/40 px-2.5 py-1.5 font-mono text-xs text-foreground/80">
        {entry.governance.measurand}
      </div>

      <div className="mt-3">
        <p className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Fontes
        </p>
        <div className="flex flex-wrap gap-1.5">
          {sources.slice(0, 3).map((source) => (
            <Badge
              key={`${source.title}-${source.edition}`}
              variant="outline"
              className="font-mono text-[11px]"
            >
              {shortSourceSigla(source)}
            </Badge>
          ))}
          {sources.length > 3 ? (
            <Badge variant="outline" className="font-mono text-[11px]">
              +{sources.length - 3}
            </Badge>
          ) : null}
        </div>
      </div>

      <BlueprintGrid className="mt-3 grid-cols-2">
        <BlueprintField label="A verificar" mono>
          <span
            className={cn(
              entry.counts.verificar > 0 &&
                'text-amber-700 dark:text-amber-400',
            )}
          >
            {entry.counts.verificar}
          </span>
        </BlueprintField>
        <BlueprintField label="Situacionais" mono>
          {entry.counts.omitted}
        </BlueprintField>
      </BlueprintGrid>

      <div className="mt-auto pt-3">
        <Button
          variant="outline"
          className="w-full justify-center gap-1.5"
          onClick={() => onReview(entry)}
        >
          Revisar contexto
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className="size-4"
            aria-hidden
          />
        </Button>
      </div>
    </Panel>
  )
}

function ContextStep({
  entry,
  onBack,
  onConfirm,
}: {
  entry: MethodTemplateCatalogEntry
  onBack: () => void
  onConfirm: () => void
}) {
  const actionCount = entry.governance.verificarItems.filter(
    (item) => item.severity === 'action',
  ).length
  const worked = entry.governance.workedExample

  return (
    <div className="space-y-4">
      <Panel className="p-5 sm:p-6">
        <PanelHeader
          title={entry.defaultName}
          description="Rascunho · Não acreditado — exige a verificação do seu laboratório antes do uso."
        />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SignalTile
            label="A verificar"
            value={actionCount}
            tone={actionCount > 0 ? 'warning' : 'neutral'}
          />
          <SignalTile
            label="Situacionais"
            value={entry.governance.omittedComponents.length}
            tone="neutral"
          />
          <SignalTile
            label="Fontes"
            value={entry.governance.sources.length}
            tone="neutral"
          />
          <SignalTile
            label="Exemplo"
            value={
              worked
                ? worked.provenance === 'cited_guide_table'
                  ? 'Guia'
                  : 'Motor'
                : '—'
            }
            tone={worked?.provenance === 'cited_guide_table' ? 'ok' : 'neutral'}
          />
        </div>
      </Panel>

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2">
        <TemplateGovernancePanel governance={entry.governance} />
        <div className="min-w-0 space-y-6">
          <MethodSpecPreview method={parseTemplateSpec(entry.spec)} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" onClick={onBack}>
          ← Voltar
        </Button>
        <Button className={cn(ACTION_BUTTON_CLASS)} onClick={onConfirm}>
          Confirmar adoção →
        </Button>
      </div>
    </div>
  )
}

function AckRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  children: ReactNode
}) {
  return (
    <label className="flex items-start gap-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
      />
      <span className="text-pretty text-sm">{children}</span>
    </label>
  )
}
