import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  Delete02Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'

import {
  emptyPtResultPointForm,
  parsePtResultsForm,
  type PtResultPointFormData,
} from '@/features/proficiency-tests/forms'
import {
  usePtAuditLogData,
  usePtDetailData,
  useRecordPtResults,
} from '@/features/proficiency-tests/queries'
import {
  PT_ACTIVITY_TYPE_LABELS,
  PT_STATUS_BADGE_CLASSES,
  PT_STATUS_LABELS,
  SCORE_TYPE_LABELS,
  type PtDetail,
  type PtResultPoint,
  type PtScoreType,
} from '@/features/proficiency-tests/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  ACTION_BUTTON_CLASS,
  BlueprintField,
  BlueprintGrid,
  BlueprintOverlay,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from '@/components/instrument-panel'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'
import { StandardRecallCallout } from '@/features/spc/components/standard-recall-callout'

const STATUS_TONES: Record<PtDetail['overallStatus'], SignalTone> = {
  pending: 'info',
  satisfactory: 'ok',
  questionable: 'warning',
  unsatisfactory: 'critical',
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  create: 'Criação',
  update: 'Atualização',
  record_results: 'Registro de resultados',
  escalate: 'Escalada para CAPA',
  delete: 'Remoção',
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

function formatValueWithUncertainty(value: number, uncertainty: number | null) {
  if (uncertainty == null) return String(value)
  return `${value} ± ${uncertainty}`
}

function referenceDispersion(point: PtResultPoint) {
  if (point.scoreType === 'z' || point.scoreType === 'z_prime') {
    return point.sigmaPt == null ? '-' : `σ_pt ${point.sigmaPt}`
  }
  return point.refUncertainty == null ? '-' : `± ${point.refUncertainty}`
}

export function ProficiencyTestDetailPage({ id }: { id: string }) {
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()

  const { data: pt, isLoading } = usePtDetailData({
    id,
    enabled: !cloudOnlyUnavailable,
  })

  const { data: auditLog } = usePtAuditLogData({
    id,
    enabled: !cloudOnlyUnavailable,
  })

  if (cloudOnlyUnavailable) {
    return (
      <CloudOnlyOfflineState title="Ensaio de proficiência indisponível offline" />
    )
  }

  if (isLoading) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        Carregando...
      </div>
    )
  }

  if (!pt) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        Ensaio de proficiência não encontrado
      </div>
    )
  }

  const results = pt.results ?? []

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <Panel className="relative overflow-hidden p-6">
        <BlueprintOverlay />
        <div className="relative space-y-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-balance font-mono text-2xl font-semibold tracking-tight">
                {pt.ptRound}
              </h1>
              <Badge variant="outline">
                {PT_ACTIVITY_TYPE_LABELS[pt.activityType]}
              </Badge>
              <Badge
                variant="outline"
                className={PT_STATUS_BADGE_CLASSES[pt.overallStatus]}
              >
                {PT_STATUS_LABELS[pt.overallStatus]}
              </Badge>
            </div>
            <p className="mt-1 max-w-2xl text-pretty text-sm text-muted-foreground">
              {pt.provider}
              {pt.providerAccreditation ? ` · ${pt.providerAccreditation}` : ''}
            </p>
          </div>

          <StaggerGroup className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
            <StaggerItem>
              <SignalTile
                label="Resultado"
                value={PT_STATUS_LABELS[pt.overallStatus]}
                tone={STATUS_TONES[pt.overallStatus]}
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                label="Participação"
                value={formatDate(pt.participationDate)}
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                label="Relatório do provedor"
                value={formatDate(pt.resultReportedAt)}
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                label="Pontos avaliados"
                value={results.length}
                tone="neutral"
              />
            </StaggerItem>
          </StaggerGroup>
        </div>
      </Panel>

      {/* Auto-opened CAPA warning */}
      {pt.overallStatus === 'unsatisfactory' && pt.capaId && (
        <Panel className="border-l-4 border-l-destructive p-4">
          <div className="flex items-start gap-3">
            <HugeiconsIcon
              icon={Alert02Icon}
              className="mt-0.5 size-5 shrink-0 text-destructive"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Resultado insatisfatório: ação corretiva aberta
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Uma CAPA foi aberta automaticamente para tratar o resultado
                insatisfatório.{' '}
                <Link
                  to="/dashboard/capa/$id"
                  params={{ id: String(pt.capaId) }}
                  className="font-medium text-primary hover:underline"
                >
                  Abrir CAPA #{pt.capaId}
                </Link>
              </p>
            </div>
          </div>
        </Panel>
      )}

      {/* §7.10 tie-in: unsatisfactory PT may compromise issued results */}
      {pt.overallStatus === 'unsatisfactory' && pt.standardId && (
        <StandardRecallCallout
          standardId={pt.standardId}
          standardName={pt.standardName}
          message="Resultado insatisfatório — considere revisar os certificados emitidos com este padrão (recall de padrão)."
        />
      )}

      {/* Identification */}
      <Panel className="p-4 sm:p-5">
        <PanelHeader
          title="Dados da participação"
          action={
            pt.capaId && pt.overallStatus !== 'unsatisfactory' ? (
              <Button
                variant="outline"
                size="sm"
                render={
                  <Link
                    to="/dashboard/capa/$id"
                    params={{ id: String(pt.capaId) }}
                  />
                }
              >
                CAPA #{pt.capaId}
              </Button>
            ) : undefined
          }
        />
        <BlueprintGrid className="mt-4 sm:grid-cols-2 lg:grid-cols-3">
          <BlueprintField label="Provedor">{pt.provider}</BlueprintField>
          <BlueprintField label="Acreditação">
            {pt.providerAccreditation ?? '—'}
          </BlueprintField>
          <BlueprintField label="Parte do escopo">
            {pt.scopePart}
          </BlueprintField>
          <BlueprintField label="Grandeza">
            {pt.metrologyKind ?? '—'}
          </BlueprintField>
          <BlueprintField label="Padrão vinculado">
            {pt.standardId ? (
              <Link
                to="/dashboard/standards/$id"
                params={{ id: String(pt.standardId) }}
                className="text-primary hover:underline"
              >
                {pt.standardName ?? `Padrão #${pt.standardId}`}
              </Link>
            ) : (
              '—'
            )}
          </BlueprintField>
          <BlueprintField label="Inscrição" mono>
            {formatDate(pt.registrationDate)}
          </BlueprintField>
          <BlueprintField label="Registrado por">
            {pt.createdByName ?? pt.createdBy}
          </BlueprintField>
          <BlueprintField label="Criado em" mono>
            {formatDate(pt.createdAt)}
          </BlueprintField>
          <BlueprintField label="Observações">{pt.notes ?? '—'}</BlueprintField>
        </BlueprintGrid>
      </Panel>

      {/* Results table */}
      {results.length > 0 && (
        <Panel className="p-4 sm:p-5">
          <PanelHeader
            title="Resultados avaliados"
            description="Escores calculados conforme ISO 13528 a partir do relatório do provedor."
          />
          <div className="mt-4 overflow-x-auto rounded-xl bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-border/70 bg-muted/40">
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                    Ponto
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    Valor do laboratório
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    Valor de referência
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                    Unidade
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                    Escore
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    Valor
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                    Veredito
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((point, index) => (
                  <tr
                    key={`${point.label}-${index}`}
                    className="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/35"
                  >
                    <td className="px-3 py-2.5">{point.label}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {formatValueWithUncertainty(
                        point.labValue,
                        point.labUncertainty,
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {point.refValue} ({referenceDispersion(point)})
                    </td>
                    <td className="px-3 py-2.5">{point.unit ?? '-'}</td>
                    <td className="px-3 py-2.5 font-mono">
                      {SCORE_TYPE_LABELS[point.scoreType]}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {point.score == null ? '-' : point.score.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5">
                      {point.verdict ? (
                        <Badge
                          variant="outline"
                          className={PT_STATUS_BADGE_CLASSES[point.verdict]}
                        >
                          {PT_STATUS_LABELS[point.verdict]}
                        </Badge>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Record results */}
      {!pt.resultReportedAt && <RecordResultsPanel id={id} />}

      {/* Audit Log */}
      {auditLog && auditLog.data.length > 0 && (
        <Panel className="p-4 sm:p-5">
          <PanelHeader title="Histórico de alterações" />
          <div className="mt-4 space-y-3">
            {auditLog.data.map((log) => (
              <div
                key={log.id}
                className="flex items-start justify-between rounded-lg border p-3"
              >
                <div>
                  <span className="font-medium">
                    {AUDIT_ACTION_LABELS[log.action] ?? log.action}
                  </span>
                  <p className="text-sm text-muted-foreground">
                    por {log.performedByName ?? log.performedBy}
                  </p>
                  {log.reason && <p className="text-sm mt-1">{log.reason}</p>}
                </div>
                <span className="text-sm text-muted-foreground">
                  {new Date(log.performedAt).toLocaleString('pt-BR')}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

function scoreTypeUsesSigma(scoreType: PtScoreType) {
  return scoreType === 'z' || scoreType === 'z_prime'
}

function RecordResultsPanel({ id }: { id: string }) {
  const [resultReportedAt, setResultReportedAt] = useState<Date | undefined>(
    undefined,
  )
  const [rows, setRows] = useState<PtResultPointFormData[]>([
    emptyPtResultPointForm(),
  ])

  const recordMutation = useRecordPtResults(id)

  const updateRow = (index: number, patch: Partial<PtResultPointFormData>) => {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    )
  }

  const removeRow = (index: number) => {
    setRows((current) => current.filter((_, i) => i !== index))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parsePtResultsForm({ results: rows }, resultReportedAt)
    if (!parsed.success) {
      toast.error(parsed.message)
      return
    }

    recordMutation.mutate(parsed.data, {
      onSuccess: (result) => {
        if (result.overallStatus === 'unsatisfactory') {
          toast.warning(
            result.capaId
              ? `Resultado insatisfatório — CAPA #${result.capaId} aberta automaticamente`
              : 'Resultado insatisfatório registrado',
          )
        } else {
          toast.success('Resultados registrados com sucesso')
        }
      },
      onError: (error) => {
        toast.error(error.message)
      },
    })
  }

  return (
    <Panel className="p-4 sm:p-5">
      <PanelHeader
        title="Registrar resultados"
        description="Lance os pontos do relatório final. Os escores (En, z, z′, ζ) e o veredito são calculados automaticamente; resultado insatisfatório abre CAPA."
      />
      <form onSubmit={handleSubmit} className="mt-4 space-y-5">
        <div className="max-w-xs space-y-2">
          <Label>Data do relatório</Label>
          <DatePicker
            value={resultReportedAt}
            onChange={setResultReportedAt}
            placeholder="Selecione a data"
          />
        </div>

        <div className="space-y-4">
          {rows.map((row, index) => (
            <div
              key={index}
              className="space-y-3 rounded-xl border border-border/70 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Ponto {index + 1}
                </p>
                {rows.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRow(index)}
                    aria-label={`Remover ponto ${index + 1}`}
                  >
                    <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Ponto de medição</Label>
                  <Input
                    value={row.label}
                    onChange={(e) =>
                      updateRow(index, { label: e.target.value })
                    }
                    placeholder="Ex: 1 kg nominal"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Unidade (opcional)</Label>
                  <Input
                    value={row.unit}
                    onChange={(e) => updateRow(index, { unit: e.target.value })}
                    placeholder="Ex: mg"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Tipo de escore</Label>
                  <Select
                    value={row.scoreType}
                    onValueChange={(v) => {
                      if (
                        v === 'en' ||
                        v === 'z' ||
                        v === 'z_prime' ||
                        v === 'zeta'
                      ) {
                        updateRow(index, { scoreType: v })
                      }
                    }}
                  >
                    <SelectTrigger>
                      <span
                        className="flex flex-1 text-left line-clamp-1"
                        data-slot="select-value"
                      >
                        {SCORE_TYPE_LABELS[row.scoreType]}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">En (erro normalizado)</SelectItem>
                      <SelectItem value="z">z</SelectItem>
                      <SelectItem value="z_prime">z′</SelectItem>
                      <SelectItem value="zeta">ζ (zeta)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>Valor do laboratório</Label>
                  <Input
                    inputMode="decimal"
                    value={row.labValue}
                    onChange={(e) =>
                      updateRow(index, { labValue: e.target.value })
                    }
                    placeholder="Ex: 1000.02"
                  />
                </div>
                {(row.scoreType === 'en' || row.scoreType === 'zeta') && (
                  <div className="space-y-1.5">
                    <Label>Incerteza do laboratório (U)</Label>
                    <Input
                      inputMode="decimal"
                      value={row.labUncertainty}
                      onChange={(e) =>
                        updateRow(index, { labUncertainty: e.target.value })
                      }
                      placeholder="Ex: 0.05"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Valor de referência</Label>
                  <Input
                    inputMode="decimal"
                    value={row.refValue}
                    onChange={(e) =>
                      updateRow(index, { refValue: e.target.value })
                    }
                    placeholder="Ex: 1000.00"
                  />
                </div>
                {(row.scoreType === 'en' ||
                  row.scoreType === 'zeta' ||
                  row.scoreType === 'z_prime') && (
                  <div className="space-y-1.5">
                    <Label>Incerteza da referência (U)</Label>
                    <Input
                      inputMode="decimal"
                      value={row.refUncertainty}
                      onChange={(e) =>
                        updateRow(index, { refUncertainty: e.target.value })
                      }
                      placeholder="Ex: 0.02"
                    />
                  </div>
                )}
                {scoreTypeUsesSigma(row.scoreType) && (
                  <div className="space-y-1.5">
                    <Label>σ_pt (desvio-padrão do EP)</Label>
                    <Input
                      inputMode="decimal"
                      value={row.sigmaPt}
                      onChange={(e) =>
                        updateRow(index, { sigmaPt: e.target.value })
                      }
                      placeholder="Ex: 0.10"
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setRows((current) => [...current, emptyPtResultPointForm()])
            }
          >
            <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
            Adicionar ponto
          </Button>
          <Button
            type="submit"
            className={ACTION_BUTTON_CLASS}
            disabled={recordMutation.isPending}
          >
            {recordMutation.isPending
              ? 'Registrando...'
              : 'Registrar resultados'}
          </Button>
        </div>
      </form>
    </Panel>
  )
}
