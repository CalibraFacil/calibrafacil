import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FormField } from '@/shared/forms/form-field'
import { Panel, PanelHeader } from '@/components/instrument-panel'

import type {
  MethodCompileResult,
  MethodDiagnostic,
  MethodPreviewResult,
} from './types'

const INSET =
  'shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]'

export function CompilePreviewPanel({
  compileResult,
  diagnostics,
  previewResult,
  sampleDataText,
  onSampleDataTextChange,
}: {
  compileResult: MethodCompileResult | null
  diagnostics: Array<MethodDiagnostic>
  previewResult: MethodPreviewResult | null
  sampleDataText: string
  onSampleDataTextChange: (value: string) => void
}) {
  return (
    <aside className="min-h-0 space-y-4 overflow-auto xl:sticky xl:top-0">
      <Panel className="p-4 sm:p-5">
        <PanelHeader
          title="Compilação"
          description="Fingerprint, fórmulas normalizadas e diagnósticos."
        />
        <div className="mt-4 space-y-4">
          <ResultLine label="Fingerprint" value={compileResult?.fingerprint} />
          <DiagnosticsList diagnostics={diagnostics} />
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Fórmulas normalizadas
            </Label>
            {compileResult?.normalizedFormulas.length ? (
              <div className="space-y-2">
                {compileResult.normalizedFormulas.map((formula) => (
                  <div
                    key={formula.outputKey}
                    className={`rounded-xl bg-background p-3 font-mono text-xs ${INSET}`}
                  >
                    <div className="font-semibold">{formula.outputKey}</div>
                    <div className="mt-0.5 text-muted-foreground">
                      {formula.normalizedExpression}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma fórmula normalizada ainda.
              </p>
            )}
          </div>
        </div>
      </Panel>

      <Panel className="p-4 sm:p-5">
        <PanelHeader
          title="Preview"
          description="Dados de exemplo enviados ao endpoint de preview."
        />
        <div className="mt-4 space-y-4">
          <FormField label="Dados de exemplo">
            <Textarea
              value={sampleDataText}
              onChange={(event) => onSampleDataTextChange(event.target.value)}
              rows={10}
              className="font-mono text-xs"
            />
          </FormField>
          <JsonBlock label="Resultados" value={previewResult?.results} />
          {previewResult?.normalizedData && (
            <JsonBlock
              label="Dados normalizados"
              value={previewResult.normalizedData}
            />
          )}
        </div>
      </Panel>
    </aside>
  )
}

function DiagnosticsList({
  diagnostics,
}: {
  diagnostics: Array<MethodDiagnostic>
}) {
  if (diagnostics.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum diagnóstico retornado.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {diagnostics.map((diagnostic, index) => (
        <div
          key={`${diagnostic.message}-${index}`}
          className={`rounded-xl bg-background p-3 ${INSET}`}
        >
          <div className="flex items-center gap-2">
            <Badge
              variant={
                diagnostic.severity === 'error' ? 'destructive' : 'secondary'
              }
            >
              {diagnostic.severity}
            </Badge>
            {diagnostic.code && (
              <span className="font-mono text-xs text-muted-foreground">
                {diagnostic.code}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm">{diagnostic.message}</p>
          {diagnostic.path && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {diagnostic.path}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function ResultLine({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <div
        className={`min-h-9 rounded-xl bg-background px-3 py-2 font-mono text-xs ${INSET}`}
      >
        {value || 'Aguardando compilação'}
      </div>
    </div>
  )
}

function JsonBlock({
  label,
  value,
}: {
  label: string
  value?: Record<string, unknown>
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <pre
        className={`max-h-60 overflow-auto rounded-xl bg-background p-3 text-xs ${INSET}`}
      >
        {JSON.stringify(value ?? {}, null, 2)}
      </pre>
    </div>
  )
}
