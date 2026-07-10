import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { OotImpactAssessmentData } from '@calibra-facil/client-runtime'
import type { SaveOotImpactAssessmentInput } from '@calibra-facil/schemas/quality'

import { calibraApi } from '@/utils/api'
import {
  parseImpactAssessmentForm,
  type ImpactAssessmentFormData,
} from '@/features/quality/forms'
import { ShowForRole } from '@/components/permission-gate'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const ITEM_DISPOSITION_LABELS: Record<string, string> = {
  no_impact: 'Sem impacto',
  recheck: 'Reavaliar medição',
  notify_downstream: 'Notificar cadeia a jusante',
  other: 'Outro',
}

function getConclusionBadge(
  conclusion: NonNullable<OotImpactAssessmentData['conclusion']>,
) {
  switch (conclusion) {
    case 'no_significant_impact':
      return { variant: 'default' as const, label: 'Sem impacto significativo' }
    case 'impact_confirmed':
      return { variant: 'destructive' as const, label: 'Impacto confirmado' }
    case 'inconclusive':
      return { variant: 'outline' as const, label: 'Inconclusivo' }
    default:
      return { variant: 'outline' as const, label: conclusion }
  }
}

function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateOnly(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  const dateOnly = dateString.slice(0, 10)
  const [year, month, day] = dateOnly.split('-')
  if (!year || !month || !day) return dateString
  return `${day}/${month}/${year}`
}

function toDateInputValue(dateString: string | null | undefined): string {
  if (!dateString) return ''
  return dateString.slice(0, 10)
}

export function ImpactAssessmentCard({
  ncId,
  assessment,
  isLoading,
}: {
  ncId: string
  assessment: OotImpactAssessmentData | null
  isLoading: boolean
}) {
  const isSigned = Boolean(assessment?.signedAt)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Avaliação de impacto</CardTitle>
        <CardDescription>
          Avaliação guiada do impacto do resultado fora de tolerância nas
          medições do cliente (ISO/IEC 17025 §7.10)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : isSigned && assessment ? (
          <SignedAssessmentView assessment={assessment} />
        ) : (
          <>
            <ImpactAssessmentForm
              key={assessment ? assessment.updatedAt : 'new'}
              ncId={ncId}
              assessment={assessment}
            />
            {assessment && (
              <ShowForRole role={['owner', 'admin']}>
                <SignAssessmentSection ncId={ncId} assessment={assessment} />
              </ShowForRole>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ============================================================================
// Editable form (unsigned / absent assessment)
// ============================================================================

// Editable rows carry a locally generated stable key so React keeps DOM and
// input focus stable across row insertions/removals (no index keys).
type ImpactAssessmentFormState = Omit<ImpactAssessmentFormData, 'items'> & {
  items: Array<ImpactAssessmentFormData['items'][number] & { key: string }>
}

let nextItemKey = 0
function newItemKey(): string {
  nextItemKey += 1
  return `item-${nextItemKey}`
}

function ImpactAssessmentForm({
  ncId,
  assessment,
}: {
  ncId: string
  assessment: OotImpactAssessmentData | null
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ImpactAssessmentFormState>(() => ({
    deviationSummary: assessment?.deviationSummary ?? '',
    deviationMagnitude:
      assessment?.deviationMagnitude != null
        ? String(assessment.deviationMagnitude)
        : '',
    customerTolerance:
      assessment?.customerTolerance != null
        ? String(assessment.customerTolerance)
        : '',
    toleranceUnit: assessment?.toleranceUnit ?? '',
    affectedFrom: toDateInputValue(assessment?.affectedFrom),
    affectedTo: toDateInputValue(assessment?.affectedTo),
    items: (assessment?.items ?? []).map((item) => ({
      key: newItemKey(),
      description: item.description,
      disposition: item.disposition,
      note: item.note ?? '',
    })),
    conclusion: assessment?.conclusion ?? '',
    correctiveActionNote: assessment?.correctiveActionNote ?? '',
  }))

  const setField = <
    TField extends Exclude<keyof ImpactAssessmentFormData, 'items'>,
  >(
    field: TField,
    value: ImpactAssessmentFormData[TField],
  ) => setForm((current) => ({ ...current, [field]: value }))

  const updateItem = (
    key: string,
    patch: Partial<ImpactAssessmentFormData['items'][number]>,
  ) =>
    setForm((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.key === key ? { ...item, ...patch } : item,
      ),
    }))

  const addItem = () =>
    setForm((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          key: newItemKey(),
          description: '',
          disposition: 'no_impact',
          note: '',
        },
      ],
    }))

  const removeItem = (key: string) =>
    setForm((current) => ({
      ...current,
      items: current.items.filter((item) => item.key !== key),
    }))

  const saveMutation = useMutation({
    mutationFn: (input: SaveOotImpactAssessmentInput) =>
      calibraApi.nonConformances.saveImpactAssessment(ncId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['non-conformance-impact-assessment', ncId],
      })
      queryClient.invalidateQueries({
        queryKey: ['non-conformance-audit', ncId],
      })
      toast.success('Avaliação de impacto salva')
    },
    onError: (error) => toast.error(error.message),
  })

  const handleSave = () => {
    const result = parseImpactAssessmentForm(form)
    if (!result.success) {
      toast.error(result.message)
      return
    }
    saveMutation.mutate(result.data)
  }

  const magnitude = Number(form.deviationMagnitude)
  const tolerance = Number(form.customerTolerance)
  const showTriageHint =
    form.deviationMagnitude.trim() !== '' &&
    form.customerTolerance.trim() !== '' &&
    Number.isFinite(magnitude) &&
    Number.isFinite(tolerance) &&
    magnitude > 0 &&
    tolerance > 0 &&
    magnitude / tolerance <= 0.1

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Natureza e magnitude do desvio</Label>
        <Textarea
          value={form.deviationSummary}
          onChange={(e) => setField('deviationSummary', e.target.value)}
          placeholder="Descreva a natureza do desvio observado e sua magnitude..."
          rows={3}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-2">
          <Label>Desvio (valor absoluto)</Label>
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={form.deviationMagnitude}
            onChange={(e) => setField('deviationMagnitude', e.target.value)}
            placeholder="ex.: 0.02"
          />
        </div>
        <div className="space-y-2">
          <Label>Tolerância do cliente</Label>
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={form.customerTolerance}
            onChange={(e) => setField('customerTolerance', e.target.value)}
            placeholder="ex.: 0.5"
          />
        </div>
        <div className="space-y-2">
          <Label>Unidade</Label>
          <Input
            className="w-24"
            value={form.toleranceUnit}
            onChange={(e) => setField('toleranceUnit', e.target.value)}
            placeholder="mm"
          />
        </div>
      </div>

      {showTriageHint && (
        <Alert>
          <AlertDescription>
            Desvio ≤ 10% da banda de tolerância do cliente — desvios dessa ordem
            raramente alteram decisões de aprovação/reprovação. A avaliação
            continua obrigatória.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Período afetado (de)</Label>
          <Input
            type="date"
            value={form.affectedFrom}
            onChange={(e) => setField('affectedFrom', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Período afetado (até)</Label>
          <Input
            type="date"
            value={form.affectedTo}
            onChange={(e) => setField('affectedTo', e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Itens/medições avaliados</Label>
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            Adicionar item
          </Button>
        </div>
        {form.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum item avaliado. Adicione os itens/medições potencialmente
            afetados.
          </p>
        ) : (
          <div className="space-y-3">
            {form.items.map((item) => (
              <div
                key={item.key}
                className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_220px_auto]"
              >
                <div className="space-y-2 sm:col-span-1">
                  <Input
                    value={item.description}
                    onChange={(e) =>
                      updateItem(item.key, { description: e.target.value })
                    }
                    placeholder="Descrição do item/medição"
                  />
                  <Input
                    value={item.note}
                    onChange={(e) =>
                      updateItem(item.key, { note: e.target.value })
                    }
                    placeholder="Nota (opcional)"
                  />
                </div>
                <div>
                  <Select
                    value={item.disposition}
                    onValueChange={(value) =>
                      updateItem(item.key, {
                        disposition: value ?? 'no_impact',
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Disposição" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no_impact">Sem impacto</SelectItem>
                      <SelectItem value="recheck">Reavaliar medição</SelectItem>
                      <SelectItem value="notify_downstream">
                        Notificar cadeia a jusante
                      </SelectItem>
                      <SelectItem value="other">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeItem(item.key)}
                  >
                    Remover
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Conclusão</Label>
        <Select
          value={form.conclusion}
          onValueChange={(value) => setField('conclusion', value ?? '')}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione a conclusão" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="no_significant_impact">
              Sem impacto significativo
            </SelectItem>
            <SelectItem value="impact_confirmed">Impacto confirmado</SelectItem>
            <SelectItem value="inconclusive">Inconclusivo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Ação corretiva relacionada (opcional)</Label>
        <Textarea
          value={form.correctiveActionNote}
          onChange={(e) => setField('correctiveActionNote', e.target.value)}
          placeholder="Descreva a ação corretiva relacionada, se houver..."
          rows={3}
        />
      </div>

      <Button onClick={handleSave} disabled={saveMutation.isPending}>
        {saveMutation.isPending ? 'Salvando...' : 'Salvar avaliação'}
      </Button>
    </div>
  )
}

// ============================================================================
// Sign action (admin/owner)
// ============================================================================

function SignAssessmentSection({
  ncId,
  assessment,
}: {
  ncId: string
  assessment: OotImpactAssessmentData
}) {
  const queryClient = useQueryClient()
  const [signDialogOpen, setSignDialogOpen] = useState(false)

  const signMutation = useMutation({
    mutationFn: () => calibraApi.nonConformances.signImpactAssessment(ncId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['non-conformance-impact-assessment', ncId],
      })
      queryClient.invalidateQueries({
        queryKey: ['non-conformance-audit', ncId],
      })
      toast.success('Avaliação de impacto assinada')
      setSignDialogOpen(false)
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <div className="border-t pt-4">
      <Dialog open={signDialogOpen} onOpenChange={setSignDialogOpen}>
        <DialogTrigger
          render={
            <Button variant="outline" disabled={!assessment.conclusion}>
              Assinar avaliação
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assinar avaliação de impacto</DialogTitle>
            <DialogDescription>
              A assinatura congela o registro (ISO/IEC 17025 §7.10.2).
              Confirmar?
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setSignDialogOpen(false)}
              disabled={signMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => signMutation.mutate()}
              disabled={signMutation.isPending}
            >
              {signMutation.isPending ? 'Assinando...' : 'Confirmar assinatura'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {!assessment.conclusion && (
        <p className="mt-2 text-sm text-muted-foreground">
          Salve uma conclusão antes de assinar a avaliação.
        </p>
      )}
    </div>
  )
}

// ============================================================================
// Signed read-only view
// ============================================================================

function SignedAssessmentView({
  assessment,
}: {
  assessment: OotImpactAssessmentData
}) {
  const conclusionBadge = assessment.conclusion
    ? getConclusionBadge(assessment.conclusion)
    : null
  const unit = assessment.toleranceUnit ?? ''
  const items = assessment.items ?? []

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-muted-foreground">
          Natureza e magnitude do desvio
        </Label>
        <p className="mt-1 whitespace-pre-wrap">
          {assessment.deviationSummary}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {assessment.deviationMagnitude != null && (
          <div>
            <Label className="text-muted-foreground">
              Desvio (valor absoluto)
            </Label>
            <p className="font-medium">
              {assessment.deviationMagnitude} {unit}
            </p>
          </div>
        )}
        {assessment.customerTolerance != null && (
          <div>
            <Label className="text-muted-foreground">
              Tolerância do cliente
            </Label>
            <p className="font-medium">
              {assessment.customerTolerance} {unit}
            </p>
          </div>
        )}
        {(assessment.affectedFrom || assessment.affectedTo) && (
          <div className="col-span-2">
            <Label className="text-muted-foreground">Período afetado</Label>
            <p className="font-medium">
              {formatDateOnly(assessment.affectedFrom)} até{' '}
              {formatDateOnly(assessment.affectedTo)}
            </p>
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div>
          <Label className="text-muted-foreground">
            Itens/medições avaliados
          </Label>
          <div className="mt-2 space-y-2">
            {items.map((item, index) => (
              <div
                // oxlint-disable-next-line react/no-array-index-key -- static read-only list rendered from a frozen (signed) record; items have no natural id
                key={index}
                className="flex items-start justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{item.description}</p>
                  {item.note && (
                    <p className="text-sm text-muted-foreground">{item.note}</p>
                  )}
                </div>
                <Badge variant="outline">
                  {ITEM_DISPOSITION_LABELS[item.disposition] ??
                    item.disposition}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {conclusionBadge && (
        <div>
          <Label className="text-muted-foreground">Conclusão</Label>
          <p className="mt-1">
            <Badge variant={conclusionBadge.variant}>
              {conclusionBadge.label}
            </Badge>
          </p>
        </div>
      )}

      {assessment.correctiveActionNote && (
        <div>
          <Label className="text-muted-foreground">
            Ação corretiva relacionada
          </Label>
          <p className="whitespace-pre-wrap">
            {assessment.correctiveActionNote}
          </p>
        </div>
      )}

      <p className="border-t pt-4 text-sm text-muted-foreground">
        Assinada em {formatDateTime(assessment.signedAt)}
      </p>
    </div>
  )
}
