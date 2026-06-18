import { useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import type {
  MethodFromTemplateInput,
  MethodTemplateCatalogEntry,
} from '@calibra-facil/client-runtime'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import { cn } from '@/lib/utils'

import { useMethodTemplatesData } from './queries'
import { TemplateGovernancePanel } from './components/template-governance-panel'
import {
  WizardStepper,
  type FromTemplateStepKey,
} from './components/wizard-stepper'

/**
 * "Criar método a partir de modelo" — the 3-step adoption wizard.
 *
 * Compliance (design §3): catalog cards have NO adopt affordance (only "Revisar
 * contexto"), so adoption is only reachable THROUGH the mandatory context screen;
 * adoption creates a DRAFT (never published, never accredited); the three
 * acknowledgements are required and recorded; acknowledging is explicitly NOT the
 * lab's §7.2.1.5 verification.
 */
export function FromTemplatePage() {
  const navigate = useNavigate()
  const { data: templates, isLoading, error } = useMethodTemplatesData()

  const [step, setStep] = useState<FromTemplateStepKey>('catalog')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [ackRead, setAckRead] = useState(false)
  const [ackDuty, setAckDuty] = useState(false)
  const [ackDraft, setAckDraft] = useState(false)

  const selected =
    templates?.find((entry) => entry.templateKey === selectedKey) ?? null

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

  // Derived gate — NO useEffect.
  const canSubmit =
    ackRead && ackDuty && ackDraft && name.trim().length >= 2 && !adopt.isPending

  const openContext = (entry: MethodTemplateCatalogEntry) => {
    setSelectedKey(entry.templateKey)
    setName(entry.defaultName)
    setAckRead(false)
    setAckDuty(false)
    setAckDraft(false)
    setStep('context')
  }

  const submit = () => {
    if (!selected || !canSubmit) return
    const acceptedVerificarRefs = selected.governance.verificarItems
      .filter((item) => item.severity === 'action')
      .map((item) => item.ref)
      .filter((ref): ref is string => typeof ref === 'string')
    adopt.mutate({
      templateKey: selected.templateKey,
      name: name.trim(),
      acknowledgements: {
        readVerificarAndOmitted: true,
        acceptsVerificationDuty: true,
        understandsDraftGate: true,
        acknowledgedAt: new Date().toISOString(),
        templateVersion: selected.templateVersion,
        acceptedVerificarRefs,
      },
    })
  }

  return (
    <div className="space-y-6">
      <Panel className="p-5 sm:p-6">
        <PanelHeader
          eyebrow="Cadastro"
          title="Novo método a partir de modelo"
          description="Modelos curados, fundamentados em guias publicados. Cada modelo entra como RASCUNHO e exige a verificação do seu laboratório antes do uso (ISO/IEC 17025 §7.2.1.5)."
        />
        <div className="mt-4">
          <WizardStepper current={step} />
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
          onBack={() => setStep('catalog')}
          onConfirm={() => setStep('confirm')}
        />
      ) : null}

      {step === 'confirm' && selected ? (
        <Panel className="p-5 sm:p-6">
          <PanelHeader
            eyebrow="Confirmação"
            title={`Adotar: ${selected.defaultName}`}
          />
          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="text-sm font-medium">Nome do método</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1"
                aria-label="Nome do método"
              />
            </label>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">
                Reconhecimentos (registrados na trilha de auditoria)
              </legend>
              <AckRow checked={ackRead} onChange={setAckRead}>
                Li os itens [VERIFICAR] e os componentes OMITIDOS deste modelo,
                incluindo o risco de plataforma (#506).
              </AckRow>
              <AckRow checked={ackDuty} onChange={setAckDuty}>
                Assumo o dever do meu laboratório de VERIFICAR (ISO/IEC 17025
                §7.2.1.5) e VALIDAR (§7.2.2) este método antes de usá-lo —
                reconheço que marcar estas caixas NÃO constitui essa verificação.
              </AckRow>
              <AckRow checked={ackDraft} onChange={setAckDraft}>
                Entendo que isto cria um RASCUNHO; o método não calibra até passar
                por Revisão técnica e Aprovação da qualidade (Publicado).
              </AckRow>
            </fieldset>

            <p className="text-xs text-muted-foreground">
              Após criar, você irá para o rascunho para “Solicitar aprovação”.
            </p>

            <div className="flex items-center justify-between gap-3">
              <Button variant="outline" onClick={() => setStep('context')}>
                ← Voltar
              </Button>
              <Button
                className={cn(ACTION_BUTTON_CLASS)}
                disabled={!canSubmit}
                onClick={submit}
              >
                {adopt.isPending ? 'Criando…' : 'Criar rascunho'}
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
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
      <Panel className="p-8 text-center text-sm text-muted-foreground">
        Carregando modelos…
      </Panel>
    )
  }
  if (hasError) {
    return (
      <Panel className="p-8 text-center text-sm text-destructive">
        Falha ao carregar os modelos de método.
      </Panel>
    )
  }
  if (!templates || templates.length === 0) {
    return (
      <Panel className="p-8 text-center text-sm text-muted-foreground">
        Nenhum modelo disponível no catálogo.
      </Panel>
    )
  }

  const byDiscipline = new Map<string, MethodTemplateCatalogEntry[]>()
  for (const entry of templates) {
    const list = byDiscipline.get(entry.discipline) ?? []
    list.push(entry)
    byDiscipline.set(entry.discipline, list)
  }

  return (
    <div className="space-y-6">
      {Array.from(byDiscipline.entries()).map(([discipline, entries]) => (
        <section key={discipline}>
          <p className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {discipline}
          </p>
          <StaggerGroup className="grid gap-3 sm:grid-cols-2">
            {entries.map((entry) => (
              <StaggerItem key={entry.templateKey}>
                <Panel className="flex h-full flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-medium">{entry.defaultName}</h3>
                    <div className="flex shrink-0 gap-1">
                      <Badge variant="secondary">Rascunho</Badge>
                      <Badge variant="outline">Não acreditado</Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entry.governance.measurand}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Fontes:{' '}
                    {entry.governance.sources
                      .map((source) => `${source.title} ${source.edition}`)
                      .join(' · ')}
                  </p>
                  <p className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {entry.counts.verificar} [VERIFICAR] · {entry.counts.omitted}{' '}
                    omitido(s)
                  </p>
                  <div className="mt-auto pt-3">
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => onReview(entry)}
                    >
                      Revisar contexto
                    </Button>
                  </div>
                </Panel>
              </StaggerItem>
            ))}
          </StaggerGroup>
        </section>
      ))}
      <p className="text-center text-xs text-muted-foreground">
        Modelos sem contexto metrológico completo não aparecem no catálogo.
      </p>
    </div>
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
  return (
    <div className="space-y-4">
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <TemplateGovernancePanel governance={entry.governance} />
        <Panel className="p-4 sm:p-5">
          <PanelHeader eyebrow="Especificação" title="Resumo do método" />
          <StaggerGroup className="mt-4 grid grid-cols-2 gap-3">
            <StaggerItem>
              <SignalTile
                label="Campos"
                value={String(entry.counts.dataFields)}
                hint="entradas"
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                label={
                  entry.model === 'gum_measurement_model' ? 'Modelos GUM' : 'Fórmulas'
                }
                value={String(
                  entry.model === 'gum_measurement_model'
                    ? entry.counts.uncertaintyParams + entry.counts.formulas
                    : entry.counts.formulas,
                )}
                hint="cálculos"
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                label="Critérios"
                value={String(entry.counts.validations)}
                hint="aceitação"
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                label="Incerteza B"
                value={String(entry.counts.uncertaintyParams)}
                hint="componentes"
                tone="neutral"
              />
            </StaggerItem>
          </StaggerGroup>
          <p className="mt-3 text-xs text-muted-foreground">
            A especificação completa fica visível no rascunho após a criação.
          </p>
        </Panel>
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
      <span className="text-sm text-muted-foreground">{children}</span>
    </label>
  )
}
