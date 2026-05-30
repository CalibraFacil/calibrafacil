import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  ArrowRight02Icon,
  CheckmarkCircle01Icon,
  Database01Icon,
  Upload01Icon,
} from '@hugeicons/core-free-icons'
import {
  IMPORT_FIELDS,
  type ImportEntity,
  type ImportFieldDef,
  type ImportValidationResult,
} from '@calibra-facil/schemas'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { SignalTile, type SignalTone } from '@/components/instrument-panel'
import {
  ConsoleEmpty,
  SectionPanel,
  StatusChip,
} from '@/features/backoffice/console'
import { useBackofficeImportRunsData } from '@/features/backoffice/queries'
import { applyMapping, parseCsv, type ParsedCsv } from './csv'

const ENTITY = 'assets' satisfies ImportEntity
const ENTITY_LABEL = 'Equipamentos / instrumentos'
const NONE = '__none__'

type ValidateResponse = {
  importRunId: number | null
  fields: ImportFieldDef[]
  result: ImportValidationResult
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Best-effort column → field mapping by normalized key/label match. */
function autoMap(
  headers: string[],
  fields: readonly ImportFieldDef[],
): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const field of fields) {
    const targets = [normalizeHeader(field.key), normalizeHeader(field.label)]
    const match = headers.find((header) => {
      const norm = normalizeHeader(header)
      return targets.includes(norm) || norm.includes(normalizeHeader(field.key))
    })
    if (match) mapping[field.key] = match
  }
  return mapping
}

type ParseResponse = {
  sheetName: string
  headers: string[]
  rows: string[][]
}

/** Read a File as base64 (no data: prefix) — works for large binary uploads. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler'))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Falha ao ler'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma === -1 ? result : result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

function useParseImportFile(organizationId: string) {
  return useMutation({
    mutationFn: (input: { fileBase64: string; fileName: string }) =>
      calibraApi.backoffice.parseImportFile<ParseResponse>(
        organizationId,
        input,
      ),
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Falha ao ler a planilha',
      ),
  })
}

function useValidateImportRun(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      entity: ImportEntity
      fileName?: string
      mapping: Record<string, string>
      rows: Array<Record<string, string>>
    }) =>
      calibraApi.backoffice.validateImportRun<ValidateResponse>(
        organizationId,
        input,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['backoffice', 'import-runs', organizationId],
      })
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Falha ao validar importação',
      ),
  })
}

/**
 * Migration importer (gap #12, preview-only). Paste a spreadsheet → map columns →
 * dry-run validate. Each run is audited (`import_run`); **no records are written**
 * — the commit that creates real assets is a gated follow-up.
 */
export function ImporterCard({ organizationId }: { organizationId: string }) {
  const fields = IMPORT_FIELDS[ENTITY]
  const parseFile = useParseImportFile(organizationId)
  const validate = useValidateImportRun(organizationId)
  const runs = useBackofficeImportRunsData(organizationId)

  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ValidateResponse | null>(null)

  const adopt = (next: ParsedCsv, label: string) => {
    setParsed(next)
    setSourceLabel(label)
    setMapping(autoMap(next.headers, fields))
    setResult(null)
  }

  const analyze = () => {
    const next = parseCsv(csvText)
    if (next.headers.length === 0) {
      toast.error('Não foi possível ler nenhuma coluna do conteúdo colado.')
      return
    }
    const sep = next.delimiter === '\t' ? 'tab' : next.delimiter
    adopt(next, `CSV colado · separador "${sep}"`)
  }

  const onPickFile = (file: File) => {
    setFileName(file.name)
    const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv'
    if (isCsv) {
      void file.text().then((text) => {
        setCsvText(text)
        const next = parseCsv(text)
        if (next.headers.length === 0) {
          toast.error('Arquivo CSV vazio ou ilegível.')
          return
        }
        const sep = next.delimiter === '\t' ? 'tab' : next.delimiter
        adopt(next, `${file.name} · separador "${sep}"`)
      })
      return
    }
    void fileToBase64(file).then((fileBase64) => {
      parseFile.mutate(
        { fileBase64, fileName: file.name },
        {
          onSuccess: (response) => {
            if (response.headers.length === 0) {
              toast.error('A planilha não tem cabeçalho legível.')
              return
            }
            setCsvText('')
            adopt(
              { headers: response.headers, rows: response.rows, delimiter: '' },
              `${file.name}${response.sheetName ? ` · aba "${response.sheetName}"` : ''}`,
            )
          },
        },
      )
    })
  }

  const requiredFields = fields.filter((field) => field.required)
  const canValidate =
    parsed !== null &&
    parsed.rows.length > 0 &&
    requiredFields.every((field) => mapping[field.key])

  const runValidate = () => {
    if (!parsed || !canValidate) return
    const rows = applyMapping(
      parsed,
      mapping,
      fields.map((field) => field.key),
    )
    validate.mutate(
      {
        entity: ENTITY,
        fileName: fileName.trim() || undefined,
        mapping,
        rows,
      },
      { onSuccess: (response) => setResult(response) },
    )
  }

  return (
    <SectionPanel
      eyebrow="Time-to-value"
      title="Importação / migração"
      description="Traga a base do laboratório por planilha. Simulação valida tudo antes — nenhum dado é gravado nesta etapa."
      action={
        <StatusChip tone="info" icon={Database01Icon}>
          {ENTITY_LABEL}
        </StatusChip>
      }
      contentClassName="space-y-5"
    >
      {/* Step 1 — paste */}
      <div className="space-y-2">
        <Textarea
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
          placeholder={`Cole o CSV aqui (vírgula, ponto-e-vírgula ou tab)…\n\ntag,name,serialNumber,manufacturer,model\nBAL-001,Balança analítica,SN-123,Mettler,XPE205`}
          className="min-h-28 font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={analyze}
            disabled={csvText.trim().length === 0}
            className="min-h-10 transition-transform active:scale-[0.96]"
          >
            <HugeiconsIcon icon={Upload01Icon} className="size-4" />
            Analisar colado
          </Button>
          <span className="text-xs text-muted-foreground">ou</span>
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium shadow-[inset_0_0_0_1px_rgba(15,23,42,0.12)] transition-[background-color,transform] hover:bg-muted active:scale-[0.96] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onPickFile(file)
                event.target.value = ''
              }}
            />
            <HugeiconsIcon icon={Database01Icon} className="size-4" />
            {parseFile.isPending ? 'Lendo…' : 'Enviar .xlsx / .csv'}
          </label>
        </div>
      </div>

      {/* Step 2 — map */}
      {parsed && parsed.headers.length > 0 ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {parsed.rows.length} linha(s)
            {sourceLabel ? ` · ${sourceLabel}` : ''} · mapeie as colunas:
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.map((field) => (
              <label key={field.key} className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">
                  {field.label}
                  {field.required ? (
                    <span className="text-destructive"> *</span>
                  ) : null}
                </span>
                <NativeSelect
                  value={mapping[field.key] ?? NONE}
                  onChange={(event) =>
                    setMapping((prev) => {
                      const next = { ...prev }
                      if (event.target.value === NONE) delete next[field.key]
                      else next[field.key] = event.target.value
                      return next
                    })
                  }
                >
                  <NativeSelectOption value={NONE}>
                    — ignorar —
                  </NativeSelectOption>
                  {parsed.headers.map((header) => (
                    <NativeSelectOption key={header} value={header}>
                      {header}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
            ))}
          </div>
          <Button
            type="button"
            onClick={runValidate}
            disabled={!canValidate || validate.isPending}
            className="min-h-10 transition-transform active:scale-[0.96]"
          >
            <HugeiconsIcon icon={ArrowRight02Icon} className="size-4" />
            Validar (simulação)
          </Button>
        </div>
      ) : null}

      {/* Step 3 — dry-run result */}
      {result ? <ValidationResult response={result} /> : null}

      {/* Audit — recent runs */}
      <div className="space-y-2 border-t border-border/60 pt-4">
        <p className="text-xs font-medium text-muted-foreground">
          Importações recentes
        </p>
        {runs.isPending ? (
          <Skeleton className="h-10 w-full rounded-lg" />
        ) : (runs.data?.data.length ?? 0) === 0 ? (
          <ConsoleEmpty
            icon={Database01Icon}
            title="Nenhuma importação"
            description="As simulações de importação ficam registradas aqui."
          />
        ) : (
          <div className="space-y-1.5">
            {runs.data?.data.map((run) => (
              <div
                key={run.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]"
              >
                <span className="truncate">
                  {run.fileName || run.entity}
                  <span className="text-muted-foreground">
                    {run.createdByName ? ` · ${run.createdByName}` : ''}
                  </span>
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {run.validRows}/{run.totalRows} ok
                  {run.errorRows > 0 ? (
                    <span className="text-destructive">
                      {' '}
                      · {run.errorRows} erro(s)
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionPanel>
  )
}

function ValidationResult({ response }: { response: ValidateResponse }) {
  const { result } = response
  const errorTone: SignalTone = result.errorRows > 0 ? 'critical' : 'ok'

  return (
    <div className="space-y-3 rounded-xl bg-muted/40 p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <SignalTile label="Linhas" value={result.totalRows} tone="neutral" />
        <SignalTile
          icon={CheckmarkCircle01Icon}
          label="Válidas"
          value={result.validRows}
          tone={result.validRows > 0 ? 'ok' : 'neutral'}
        />
        <SignalTile
          icon={Alert02Icon}
          label="Com erro"
          value={result.errorRows}
          tone={errorTone}
        />
      </div>

      {result.errors.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Erros{result.errorsTruncated ? ' (amostra)' : ''}
          </p>
          <div className="max-h-48 space-y-1 overflow-auto">
            {result.errors.map((error, index) => (
              <p
                key={`${error.row}-${error.field}-${index}`}
                className="text-xs"
              >
                <span className="tabular-nums text-muted-foreground">
                  linha {error.row}
                </span>{' '}
                · {error.message}
              </p>
            ))}
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-3.5" />
          Tudo válido — pronto para o commit (etapa seguinte).
        </p>
      )}
    </div>
  )
}
