import { useState } from 'react'

import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'

import {
  isMetrologyRegime,
  isRegulatedKind,
  isSecondaryRegulationProvenance,
  METROLOGY_REGIME_LABELS,
  METROLOGY_REGIMES,
  REGULATED_ANCHOR_LABELS,
  REGULATED_INTERVAL_KINDS,
  REGULATED_KIND_LABELS,
  REGULATION_CATALOG_SECONDARY_CAVEAT,
  regulationCatalogToRegimePatch,
  regulationTechnologyPatch,
  type LegalMetrologyRegulationCatalogEntry,
  type MetrologyRegimeFormValues,
} from '@/features/assets/forms'
import { useLegalMetrologyRegulationsData } from '@/features/assets/queries'

/**
 * Lab-form fields for the legal-metrology regime + the regulation-fixed verification
 * periodicity (Track 2). Shared by the asset create + edit forms (REQ-MLR-062/063). The
 * customer-owned calibration interval is never authored here — it is the customer's
 * decision in the portal (§7.8.4.3 + ILAC-G24). `onChange` receives a typed patch the
 * parent merges into its form state.
 */
export function MetrologyRegimeFields({
  values,
  onChange,
  disabled,
  errors,
}: {
  values: MetrologyRegimeFormValues
  onChange: (patch: Partial<MetrologyRegimeFormValues>) => void
  disabled?: boolean
  // Field-keyed validation messages from the parse step (REQ-POLISH-001). Each
  // regulated field surfaces its own inline error, next to the offending input.
  errors?: Partial<
    Record<
      | 'regulationReference'
      | 'regulatedValueMonths'
      | 'regulatedTechnology'
      | 'regulatedAnchor',
      string
    >
  >
}) {
  const { regulatedKind } = values
  const anchorOptions =
    regulatedKind === 'fixed_months'
      ? (['last_verification', 'calendar_year'] as const)
      : regulatedKind === 'per_technology'
        ? (['last_verification', 'first_verification'] as const)
        : null

  // The GLOBAL regulation catalog the lab can auto-fill from (suggestion-only). Only
  // fetched while the LEGAL regime is active.
  const isLegal = values.metrologyRegime === 'LEGAL'
  const catalogQuery = useLegalMetrologyRegulationsData(isLegal)
  const catalog = catalogQuery.data ?? []
  const [selectedRegulationId, setSelectedRegulationId] = useState<number | null>(
    null,
  )
  const selectedRegulation =
    catalog.find((entry) => entry.id === selectedRegulationId) ?? null

  function applyRegulation(entry: LegalMetrologyRegulationCatalogEntry) {
    setSelectedRegulationId(entry.id)
    onChange(regulationCatalogToRegimePatch(entry))
  }

  const showSecondaryCaveat =
    selectedRegulation !== null &&
    isSecondaryRegulationProvenance(selectedRegulation)

  return (
    <div className="mt-4 space-y-4">
      <Field>
        <FieldLabel htmlFor="metrologyRegime">Regime metrológico</FieldLabel>
        <Select
          value={values.metrologyRegime}
          onValueChange={(value) => {
            if (value && isMetrologyRegime(value))
              onChange({ metrologyRegime: value })
          }}
          disabled={disabled}
        >
          <SelectTrigger id="metrologyRegime">
            <span>{METROLOGY_REGIME_LABELS[values.metrologyRegime]}</span>
          </SelectTrigger>
          <SelectContent>
            {METROLOGY_REGIMES.map((regime) => (
              <SelectItem key={regime} value={regime}>
                {METROLOGY_REGIME_LABELS[regime]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          Definido pelo enquadramento legal do instrumento, não pelo
          laboratório. “Metrologia legal” fixa a periodicidade de verificação
          por regulamento (Inmetro); habilita lacre e Etiqueta de Reparo na OS.
        </FieldDescription>
      </Field>

      {values.metrologyRegime === 'LEGAL' ? (
        <div className="space-y-4 rounded-xl border p-4">
          {catalog.length > 0 ? (
            <Field>
              <FieldLabel htmlFor="regulationCatalog">
                Regulamento (catálogo)
              </FieldLabel>
              <Select
                value={
                  selectedRegulationId !== null
                    ? String(selectedRegulationId)
                    : ''
                }
                onValueChange={(value) => {
                  const entry = catalog.find(
                    (candidate) => String(candidate.id) === value,
                  )
                  if (entry) applyRegulation(entry)
                }}
                disabled={disabled}
              >
                <SelectTrigger id="regulationCatalog">
                  <span>
                    {selectedRegulation?.category ??
                      'Selecione um regulamento para preencher'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {catalog.map((entry) => (
                    <SelectItem key={entry.id} value={String(entry.id)}>
                      {entry.category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Preenche os campos abaixo a partir da Portaria escolhida — um
                padrão que você pode ajustar (o enquadramento depende do uso).
              </FieldDescription>
            </Field>
          ) : null}

          {selectedRegulation !== null &&
          selectedRegulation.kind === 'per_technology' &&
          selectedRegulation.byTechnology !== null ? (
            <Field>
              <FieldLabel htmlFor="regulationCatalogTechnology">
                Tecnologia (catálogo)
              </FieldLabel>
              <Select
                value={values.regulatedTechnology}
                onValueChange={(value) => {
                  if (value)
                    onChange(
                      regulationTechnologyPatch(selectedRegulation, value),
                    )
                }}
                disabled={disabled}
              >
                <SelectTrigger id="regulationCatalogTechnology">
                  <span>
                    {values.regulatedTechnology || 'Selecione a tecnologia'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(selectedRegulation.byTechnology).map(
                    ([technology, months]) => (
                      <SelectItem key={technology} value={technology}>
                        {technology} — {months} meses
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <Field>
            <FieldLabel htmlFor="regulatedKind">
              Tipo de periodicidade
            </FieldLabel>
            <Select
              value={regulatedKind}
              onValueChange={(value) => {
                if (value && isRegulatedKind(value))
                  onChange({ regulatedKind: value })
              }}
              disabled={disabled}
            >
              <SelectTrigger id="regulatedKind">
                <span>{REGULATED_KIND_LABELS[regulatedKind]}</span>
              </SelectTrigger>
              <SelectContent>
                {REGULATED_INTERVAL_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {REGULATED_KIND_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="regulationReference">
              Referência do regulamento
            </FieldLabel>
            <Input
              id="regulationReference"
              value={values.regulationReference}
              onChange={(e) =>
                onChange({ regulationReference: e.target.value })
              }
              placeholder="Ex.: Portaria Inmetro nº 157/2022"
              disabled={disabled}
              autoComplete="off"
            />
            {showSecondaryCaveat ? (
              <FieldDescription>
                <span className="text-amber-600">
                  {REGULATION_CATALOG_SECONDARY_CAVEAT}
                </span>{' '}
                — confirme o artigo da Portaria no Diário Oficial da União antes
                de usar em certificado.
              </FieldDescription>
            ) : null}
            {errors?.regulationReference ? (
              <FieldError>{errors.regulationReference}</FieldError>
            ) : null}
          </Field>

          {regulatedKind !== 'not_nationally_fixed' ? (
            <Field>
              <FieldLabel htmlFor="regulatedValueMonths">
                Periodicidade (meses)
              </FieldLabel>
              <Input
                id="regulatedValueMonths"
                type="number"
                min={1}
                max={600}
                value={values.regulatedValueMonths}
                onChange={(e) =>
                  onChange({ regulatedValueMonths: e.target.value })
                }
                disabled={disabled}
              />
              {errors?.regulatedValueMonths ? (
                <FieldError>{errors.regulatedValueMonths}</FieldError>
              ) : null}
            </Field>
          ) : null}

          {anchorOptions ? (
            <Field>
              <FieldLabel htmlFor="regulatedAnchor">
                Âncora da contagem
              </FieldLabel>
              <Select
                value={values.regulatedAnchor}
                onValueChange={(value) => {
                  if (value) onChange({ regulatedAnchor: value })
                }}
                disabled={disabled}
              >
                <SelectTrigger id="regulatedAnchor">
                  <span>
                    {REGULATED_ANCHOR_LABELS[values.regulatedAnchor] ??
                      values.regulatedAnchor}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {anchorOptions.map((anchor) => (
                    <SelectItem key={anchor} value={anchor}>
                      {REGULATED_ANCHOR_LABELS[anchor]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors?.regulatedAnchor ? (
                <FieldError>{errors.regulatedAnchor}</FieldError>
              ) : null}
            </Field>
          ) : null}

          {regulatedKind === 'per_technology' ? (
            <Field>
              <FieldLabel htmlFor="regulatedTechnology">
                Tecnologia do instrumento
              </FieldLabel>
              <Input
                id="regulatedTechnology"
                value={values.regulatedTechnology}
                onChange={(e) =>
                  onChange({ regulatedTechnology: e.target.value })
                }
                placeholder="Ex.: diafragma, ultrassônico…"
                disabled={disabled}
                autoComplete="off"
              />
              {errors?.regulatedTechnology ? (
                <FieldError>{errors.regulatedTechnology}</FieldError>
              ) : null}
            </Field>
          ) : null}

          {regulatedKind === 'not_nationally_fixed' ? (
            <Field>
              <FieldLabel htmlFor="regulatedNote">Observação</FieldLabel>
              <Input
                id="regulatedNote"
                value={values.regulatedNote}
                onChange={(e) => onChange({ regulatedNote: e.target.value })}
                placeholder="Ex.: sem periodicidade Inmetro; ANEEL é regime distinto."
                disabled={disabled}
                autoComplete="off"
              />
            </Field>
          ) : null}

          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={values.regulatedOperationalizedByDelegate}
              onCheckedChange={(checked) =>
                onChange({
                  regulatedOperationalizedByDelegate: Boolean(checked),
                })
              }
              disabled={disabled}
            />
            <span>
              <span className="font-medium">
                Cadência operacionalizada pelo Ipem
              </span>
              <span className="text-muted-foreground block">
                Marque para balanças/bombas/esfigmomanômetros — a data é
                indicativa (o Ipem agenda), não um prazo nacional fixo.
              </span>
            </span>
          </label>
        </div>
      ) : null}
    </div>
  )
}
