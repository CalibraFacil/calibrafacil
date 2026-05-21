import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { FormField } from '@/shared/forms/form-field'

import type {
  MethodCompileResult,
  MethodDiagnostic,
  MethodPreviewResult,
} from './types'

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
    <aside className="min-h-0 overflow-auto">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Compilação</CardTitle>
            <CardDescription>
              Fingerprint, fórmulas normalizadas e diagnósticos retornados pelo
              servidor.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ResultLine
              label="Fingerprint"
              value={compileResult?.fingerprint}
            />
            <DiagnosticsList diagnostics={diagnostics} />
            <Separator />
            <div className="space-y-2">
              <Label>Fórmulas normalizadas</Label>
              {compileResult?.normalizedFormulas.length ? (
                <div className="space-y-2">
                  {compileResult.normalizedFormulas.map((formula) => (
                    <div
                      key={formula.outputKey}
                      className="rounded-md bg-muted p-3 font-mono text-xs"
                    >
                      <div className="font-semibold">{formula.outputKey}</div>
                      <div>{formula.normalizedExpression}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma fórmula normalizada ainda.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              Dados de exemplo enviados ao endpoint de preview.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
          </CardContent>
        </Card>
      </div>
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
          className="rounded-md border p-3"
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
      <Label>{label}</Label>
      <div className="min-h-9 rounded-md bg-muted px-3 py-2 font-mono text-xs">
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
      <Label>{label}</Label>
      <pre className="max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs">
        {JSON.stringify(value ?? {}, null, 2)}
      </pre>
    </div>
  )
}
