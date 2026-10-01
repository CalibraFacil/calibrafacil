"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Cancel01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  COVERAGE_PROBABILITIES,
  DISTRIBUTIONS,
  evaluateBudget,
  type BudgetIssue,
  type ContributionInput,
  type ContributionResult,
  type DistributionId,
} from "@/lib/uncertainty/budget";
import {
  formatDegreesOfFreedom,
  formatPercent,
  formatQuantity,
  formatSignificant,
} from "@/lib/uncertainty/format";

/* The public GUM calculator. All arithmetic lives in lib/uncertainty/budget.ts
   and runs through @calibra-facil/math-engine — this file only collects input
   and renders. State is derived on render, never synchronised in an effect. */

/** A recognisable mass budget, so the page is useful before anything is typed. */
function defaultContributions(): ContributionInput[] {
  return [
    {
      id: "c1",
      label: "Repetibilidade da indicação",
      kind: "typeA",
      observations: "100,02 100,01 100,03 100,02 100,02 100,01",
      distribution: "rectangular",
      halfWidth: "",
      expandedUncertainty: "",
      coverageFactor: "",
      sensitivity: "1",
      degreesOfFreedom: "",
    },
    {
      id: "c2",
      label: "Certificado do padrão de massa",
      kind: "typeB",
      observations: "",
      distribution: "normal",
      halfWidth: "",
      expandedUncertainty: "0,02",
      coverageFactor: "2",
      sensitivity: "1",
      degreesOfFreedom: "",
    },
    {
      id: "c3",
      label: "Resolução do indicador",
      kind: "typeB",
      observations: "",
      distribution: "rectangular",
      halfWidth: "0,005",
      expandedUncertainty: "",
      coverageFactor: "",
      sensitivity: "1",
      degreesOfFreedom: "",
    },
    {
      id: "c4",
      label: "Deriva do padrão desde a última calibração",
      kind: "typeB",
      observations: "",
      distribution: "rectangular",
      halfWidth: "0,01",
      expandedUncertainty: "",
      coverageFactor: "",
      sensitivity: "1",
      degreesOfFreedom: "",
    },
  ];
}

function emptyContribution(id: string): ContributionInput {
  return {
    id,
    label: "Nova contribuição",
    kind: "typeB",
    observations: "",
    distribution: "rectangular",
    halfWidth: "0",
    expandedUncertainty: "",
    coverageFactor: "",
    sensitivity: "1",
    degreesOfFreedom: "",
  };
}

const fieldClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const labelClass =
  "mb-1.5 block font-mono text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase";
const numeric = "font-mono tabular-nums";

function isDistributionId(value: string): value is DistributionId {
  return DISTRIBUTIONS.some((item) => item.id === value);
}

function Field({
  label,
  symbol,
  hint,
  children,
}: {
  label: string;
  /** Rendered outside the uppercase run: "uppercase" turns ν into Ν, which
      reads as a Latin N and silently changes the notation. */
  symbol?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className={labelClass}>
        {symbol ? (
          <>
            <span className="normal-case">{symbol}</span>
            <span aria-hidden> — </span>
          </>
        ) : null}
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

function IssueText({ issues }: { issues: readonly BudgetIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <p className="mt-2 text-xs text-destructive">
      {issues.map((issue) => issue.message).join(" ")}
    </p>
  );
}

function ContributionCard({
  contribution,
  index,
  issues,
  canRemove,
  onChange,
  onRemove,
}: {
  contribution: ContributionInput;
  index: number;
  issues: readonly BudgetIssue[];
  canRemove: boolean;
  onChange: (next: ContributionInput) => void;
  onRemove: () => void;
}) {
  const distribution = DISTRIBUTIONS.find(
    (item) => item.id === contribution.distribution,
  );
  const isTypeA = contribution.kind === "typeA";
  const isNormal = contribution.distribution === "normal";

  return (
    <li className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span
          className={cn(numeric, "mt-2 text-xs text-muted-foreground")}
          aria-hidden
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <input
            value={contribution.label}
            onChange={(event) =>
              onChange({ ...contribution, label: event.target.value })
            }
            aria-label={`Nome da contribuição ${index + 1}`}
            className="w-full border-0 bg-transparent p-0 text-[15px] font-semibold tracking-[-0.01em] text-foreground outline-none focus-visible:underline"
          />
        </div>
        {canRemove ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
            aria-label={`Remover ${contribution.label}`}
          >
            <HugeiconsIcon icon={Cancel01Icon} />
          </Button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Avaliação">
          <select
            value={contribution.kind}
            onChange={(event) =>
              onChange({
                ...contribution,
                kind: event.target.value === "typeA" ? "typeA" : "typeB",
              })
            }
            className={fieldClass}
          >
            <option value="typeA">Tipo A — observações repetidas</option>
            <option value="typeB">Tipo B — outra fonte</option>
          </select>
        </Field>

        {isTypeA ? null : (
          <Field label="Distribuição" hint={distribution?.hint}>
            <select
              value={contribution.distribution}
              onChange={(event) => {
                const value = event.target.value;
                if (!isDistributionId(value)) return;
                onChange({ ...contribution, distribution: value });
              }}
              className={fieldClass}
            >
              {DISTRIBUTIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {isTypeA ? (
        <div className="mt-4">
          <Field
            label="Observações"
            hint="Separe por espaço, quebra de linha ou ponto e vírgula. A vírgula é decimal."
          >
            <textarea
              value={contribution.observations}
              onChange={(event) =>
                onChange({ ...contribution, observations: event.target.value })
              }
              rows={3}
              className={cn(fieldClass, numeric, "resize-y")}
            />
          </Field>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {isNormal ? (
            <>
              <Field label="incerteza expandida" symbol="U">
                <input
                  value={contribution.expandedUncertainty}
                  onChange={(event) =>
                    onChange({
                      ...contribution,
                      expandedUncertainty: event.target.value,
                    })
                  }
                  inputMode="decimal"
                  className={cn(fieldClass, numeric)}
                />
              </Field>
              <Field label="fator de abrangência" symbol="k">
                <input
                  value={contribution.coverageFactor}
                  onChange={(event) =>
                    onChange({
                      ...contribution,
                      coverageFactor: event.target.value,
                    })
                  }
                  inputMode="decimal"
                  className={cn(fieldClass, numeric)}
                />
              </Field>
            </>
          ) : (
            <Field
              label="meia-largura"
              symbol="a"
              hint="Metade do intervalo dentro do qual o valor pode estar."
            >
              <input
                value={contribution.halfWidth}
                onChange={(event) =>
                  onChange({ ...contribution, halfWidth: event.target.value })
                }
                inputMode="decimal"
                className={cn(fieldClass, numeric)}
              />
            </Field>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="coef. de sensibilidade" symbol="c">
          <input
            value={contribution.sensitivity}
            onChange={(event) =>
              onChange({ ...contribution, sensitivity: event.target.value })
            }
            inputMode="decimal"
            className={cn(fieldClass, numeric)}
          />
        </Field>
        {isTypeA ? null : (
          <Field label="graus de liberdade" symbol="ν" hint="Vazio = infinito.">
            <input
              value={contribution.degreesOfFreedom}
              onChange={(event) =>
                onChange({
                  ...contribution,
                  degreesOfFreedom: event.target.value,
                })
              }
              inputMode="decimal"
              placeholder="∞"
              className={cn(fieldClass, numeric)}
            />
          </Field>
        )}
      </div>

      <IssueText issues={issues} />
    </li>
  );
}

function BudgetRow({ row, unit }: { row: ContributionResult; unit: string }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2.5 pr-3 text-foreground">{row.label}</td>
      <td className="py-2.5 pr-3 text-muted-foreground">
        {row.kind === "typeA" ? "A" : "B"}
      </td>
      <td className={cn(numeric, "py-2.5 pr-3 text-muted-foreground")}>
        {row.divisorLabel}
      </td>
      <td className={cn(numeric, "py-2.5 pr-3 text-right text-foreground")}>
        {formatSignificant(row.standardUncertainty)}
        {unit ? ` ${unit}` : ""}
      </td>
      <td
        className={cn(numeric, "py-2.5 pr-3 text-right text-muted-foreground")}
      >
        {formatQuantity(row.sensitivity)}
      </td>
      <td className={cn(numeric, "py-2.5 pr-3 text-right text-foreground")}>
        {formatSignificant(row.contribution)}
        {unit ? ` ${unit}` : ""}
      </td>
      <td
        className={cn(numeric, "py-2.5 pr-3 text-right text-muted-foreground")}
      >
        {formatDegreesOfFreedom(row.degreesOfFreedom)}
      </td>
      <td className={cn(numeric, "py-2.5 text-right text-muted-foreground")}>
        {formatPercent(row.indexPercent)}
      </td>
    </tr>
  );
}

export function UncertaintyCalculator() {
  const [contributions, setContributions] = useState(defaultContributions);
  const [nextId, setNextId] = useState(5);
  const [coverageId, setCoverageId] = useState("9545");
  const [unit, setUnit] = useState("g");

  const coverage =
    COVERAGE_PROBABILITIES.find((item) => item.id === coverageId) ??
    COVERAGE_PROBABILITIES[0];

  // Derived on render: the budget is a pure function of the inputs, so there
  // is nothing to synchronise and no effect to write.
  const evaluation = useMemo(
    () => evaluateBudget(contributions, coverage.probability),
    [contributions, coverage.probability],
  );

  const issuesFor = (id: string) =>
    evaluation.ok
      ? []
      : evaluation.issues.filter((issue) => issue.contributionId === id);
  const budgetIssues = evaluation.ok
    ? []
    : evaluation.issues.filter((issue) => issue.contributionId === null);

  const updateContribution = (next: ContributionInput) => {
    setContributions((current) =>
      current.map((item) => (item.id === next.id ? next : item)),
    );
  };

  const addContribution = () => {
    setContributions((current) => [
      ...current,
      emptyContribution(`c${nextId}`),
    ]);
    setNextId((current) => current + 1);
  };

  const removeContribution = (id: string) => {
    setContributions((current) => current.filter((item) => item.id !== id));
  };

  const reset = () => {
    setContributions(defaultContributions());
    setNextId(5);
    setCoverageId("9545");
    setUnit("g");
  };

  return (
    <section className="mt-12">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Unidade"
          hint="Só rótulo: entra na leitura dos resultados."
        >
          <input
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            className={cn(fieldClass, numeric)}
            placeholder="g, °C, mm…"
          />
        </Field>
        <Field label="Probabilidade de abrangência">
          <select
            value={coverageId}
            onChange={(event) => setCoverageId(event.target.value)}
            className={fieldClass}
          >
            {COVERAGE_PROBABILITIES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <h2 className="mt-10 font-mono text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Contribuições
      </h2>
      <ul className="mt-4 grid gap-4">
        {contributions.map((contribution, index) => (
          <ContributionCard
            key={contribution.id}
            contribution={contribution}
            index={index}
            issues={issuesFor(contribution.id)}
            canRemove={contributions.length > 1}
            onChange={updateContribution}
            onRemove={() => removeContribution(contribution.id)}
          />
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="outline" onClick={addContribution}>
          <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
          Adicionar contribuição
        </Button>
        <Button variant="ghost" onClick={reset}>
          <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" />
          Recomeçar do exemplo
        </Button>
      </div>

      <h2 className="mt-12 font-mono text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Resultado
      </h2>

      {evaluation.ok ? (
        <>
          <div className="mt-4 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
            {[
              {
                key: "uc",
                symbol: (
                  <>
                    u<sub>c</sub>
                  </>
                ),
                label: "combinada",
                value: `${formatSignificant(evaluation.result.combinedStandardUncertainty)}${unit ? ` ${unit}` : ""}`,
              },
              {
                key: "veff",
                symbol: (
                  <>
                    ν<sub>ef</sub>
                  </>
                ),
                label: "efetivos",
                value: formatDegreesOfFreedom(
                  evaluation.result.effectiveDegreesOfFreedom,
                ),
              },
              {
                key: "k",
                symbol: "k",
                label: "abrangência",
                value: formatQuantity(evaluation.result.coverageFactor, 4),
              },
              {
                key: "U",
                symbol: "U",
                label: "expandida",
                value: `${formatSignificant(evaluation.result.expandedUncertainty)}${unit ? ` ${unit}` : ""}`,
                strong: true,
              },
            ].map((tile) => (
              <div key={tile.key} className="bg-card px-5 py-4">
                <p className="font-mono text-[11px] tracking-[0.1em] text-muted-foreground uppercase">
                  <span className="normal-case">{tile.symbol}</span>
                  <span aria-hidden> — </span>
                  {tile.label}
                </p>
                <p
                  className={cn(
                    numeric,
                    "mt-1.5 text-xl",
                    tile.strong
                      ? "font-semibold text-primary"
                      : "text-foreground",
                  )}
                >
                  {tile.value}
                </p>
              </div>
            ))}
          </div>

          {evaluation.result.dominant ? (
            <p className="mt-4 text-[15px] leading-relaxed text-pretty text-muted-foreground">
              A maior contribuição é{" "}
              <strong className="font-medium text-foreground">
                {evaluation.result.dominant.label}
              </strong>
              , com {formatPercent(evaluation.result.dominant.indexPercent)} da
              variância combinada. Reduzir qualquer outra fonte antes dessa muda
              pouco o resultado.
            </p>
          ) : null}

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  {[
                    { key: "fonte", node: "Fonte", notation: false },
                    { key: "tipo", node: "Tipo", notation: false },
                    { key: "divisor", node: "Divisor", notation: false },
                    {
                      key: "uxi",
                      node: (
                        <>
                          u(x<sub>i</sub>)
                        </>
                      ),
                      notation: true,
                    },
                    {
                      key: "ci",
                      node: (
                        <>
                          c<sub>i</sub>
                        </>
                      ),
                      notation: true,
                    },
                    {
                      key: "uiy",
                      node: (
                        <>
                          u<sub>i</sub>(y)
                        </>
                      ),
                      notation: true,
                    },
                    {
                      key: "vi",
                      node: (
                        <>
                          ν<sub>i</sub>
                        </>
                      ),
                      notation: true,
                    },
                    { key: "indice", node: "Índice", notation: false },
                  ].map((heading, index) => (
                    <th
                      key={heading.key}
                      className={cn(
                        "pb-2 font-mono text-[11px] font-medium tracking-[0.1em] text-muted-foreground",
                        heading.notation ? "normal-case" : "uppercase",
                        index > 2 ? "text-right" : "text-left",
                        index === 7 ? "pr-0" : "pr-3",
                      )}
                    >
                      {heading.node}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {evaluation.result.contributions.map((row) => (
                  <BudgetRow key={row.id} row={row} unit={unit} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="mt-4 rounded-xl border border-border bg-card px-5 py-6">
          <p className="text-[15px] text-muted-foreground">
            Corrija os campos destacados para ver o orçamento de incerteza.
          </p>
          <IssueText issues={budgetIssues} />
        </div>
      )}
    </section>
  );
}
