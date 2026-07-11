import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertDiamondIcon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";

import { getApiBaseUrl } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { StatusPill } from "@/components/status-pill";
import {
  ACTION_BUTTON_CLASS,
  BlueprintField,
  BlueprintGrid,
  Panel,
  PanelHeader,
  type SignalTone,
} from "@/components/instrument-panel";
import { useOotEvents } from "./queries";
import { isOotDecision, type OotDecision, type OotEvent } from "./types";

export const DECISION_META: Record<
  OotDecision,
  { label: string; tone: SignalTone }
> = {
  NO_IMPACT: { label: "Sem impacto em resultados anteriores", tone: "ok" },
  IMPACT_CONTAINED: {
    label: "Impacto identificado e contido",
    tone: "warning",
  },
  IMPACT_ESCALATED: {
    label: "Impacto identificado — ação escalada",
    tone: "critical",
  },
};

function yesNo(value: boolean | null): string {
  return value === null ? "—" : value ? "Sim" : "Não";
}

/** "2026-05-03T…" → "2026-05-03" for a date input default. */
function toDateInputValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/**
 * Out-of-tolerance impact assessment (ISO 9001:2015 §7.1.5.2 / IATF 16949
 * §7.1.5.2.1) for one asset. Determining whether previous measurement results
 * were affected is the CUSTOMER'S obligation — the portal is the workspace and
 * the auditable record. OPEN events render the assessment form; ASSESSED events
 * render the recorded decision read-only.
 */
export function OotAssessmentPanel({ assetId }: { assetId: number }) {
  const query = useOotEvents();
  const events = (query.data ?? []).filter(
    (event) => event.assetId === assetId,
  );
  if (events.length === 0) return null;

  // Newest first already (API orders by detectedAt desc); OPEN ones on top.
  const open = events.filter((event) => event.status === "OPEN");
  const assessed = events.filter((event) => event.status === "ASSESSED");

  return (
    <>
      {open.map((event) => (
        <OotAssessmentForm key={event.id} event={event} />
      ))}
      {assessed.map((event) => (
        <OotAssessmentRecord key={event.id} event={event} />
      ))}
    </>
  );
}

function OotAssessmentForm({ event }: { event: OotEvent }) {
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<OotDecision | "">("");
  const [rationale, setRationale] = useState("");
  const [periodStart, setPeriodStart] = useState(
    toDateInputValue(event.suggestedPeriodStart),
  );
  const [periodEnd, setPeriodEnd] = useState(
    toDateInputValue(event.detectedAt),
  );
  const [suspectShipped, setSuspectShipped] = useState(false);
  const [customerNotified, setCustomerNotified] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        decision,
        rationale: rationale.trim(),
        suspectProductShipped: suspectShipped,
      };
      if (periodStart) body.affectedPeriodStart = periodStart;
      if (periodEnd) body.affectedPeriodEnd = periodEnd;
      // The schema requires an answer when suspect product was shipped — the
      // checkbox IS the answer (checked = sim, unchecked = não).
      if (suspectShipped) body.customerNotified = customerNotified;

      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/oot-events/${event.id}/assessment`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        throw new Error("Não foi possível registrar a avaliação.");
      }
    },
    onSuccess: () => {
      toast.success("Avaliação registrada");
      queryClient.invalidateQueries({ queryKey: ["portal-oot-events"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const canSubmit =
    decision !== "" && rationale.trim().length >= 10 && !mutation.isPending;

  return (
    <Panel className="p-5 ring-amber-500/40">
      <PanelHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
            <HugeiconsIcon
              icon={AlertDiamondIcon}
              className="size-3.5"
              strokeWidth={2}
            />
            Ação requerida
          </span>
        }
        title="Avaliação de impacto (ISO 9001 §7.1.5.2)"
        description={
          <>
            Este instrumento foi reprovado na condição &ldquo;como
            recebido&rdquo; na calibração{" "}
            <span className="font-mono tabular-nums">
              {event.jobIdentifier}
            </span>{" "}
            ({formatDate(event.detectedAt)}). Cabe a você, como responsável pelo
            processo, determinar se resultados de medição anteriores foram
            afetados e registrar a decisão — este registro é a sua evidência de
            auditoria.
          </>
        }
      />

      <form
        className="mt-4 space-y-4"
        onSubmit={(formEvent) => {
          formEvent.preventDefault();
          if (!canSubmit) return;
          mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={`oot-decision-${event.id}`}>Decisão</Label>
          <Select
            value={decision || null}
            onValueChange={(value) => {
              if (typeof value === "string" && isOotDecision(value)) {
                setDecision(value);
              }
            }}
          >
            <SelectTrigger
              id={`oot-decision-${event.id}`}
              className="w-full"
              aria-label="Decisão da avaliação de impacto"
            >
              <span className={decision === "" ? "text-muted-foreground" : ""}>
                {decision === ""
                  ? "Selecione a decisão"
                  : DECISION_META[decision].label}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NO_IMPACT">Sem impacto</SelectItem>
              <SelectItem value="IMPACT_CONTAINED">Impacto contido</SelectItem>
              <SelectItem value="IMPACT_ESCALATED">Impacto escalado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`oot-rationale-${event.id}`}>Justificativa</Label>
          <Textarea
            id={`oot-rationale-${event.id}`}
            value={rationale}
            onChange={(changeEvent) => setRationale(changeEvent.target.value)}
            placeholder="Como o impacto foi avaliado: produtos verificados, medições repetidas, tolerâncias de processo…"
            rows={3}
          />
          <p className="text-muted-foreground text-xs text-pretty">
            Mínimo de 10 caracteres — descreva a avaliação realizada.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`oot-period-start-${event.id}`}>
              Início do período afetado
            </Label>
            <Input
              id={`oot-period-start-${event.id}`}
              type="date"
              value={periodStart}
              onChange={(changeEvent) =>
                setPeriodStart(changeEvent.target.value)
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`oot-period-end-${event.id}`}>
              Fim do período afetado
            </Label>
            <Input
              id={`oot-period-end-${event.id}`}
              type="date"
              value={periodEnd}
              onChange={(changeEvent) => setPeriodEnd(changeEvent.target.value)}
            />
          </div>
        </div>
        <p className="text-muted-foreground text-xs text-pretty">
          Janela suspeita: da última calibração aprovada até a reprovação.
        </p>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id={`oot-shipped-${event.id}`}
              checked={suspectShipped}
              onCheckedChange={(checked) => {
                setSuspectShipped(checked === true);
                if (checked !== true) setCustomerNotified(false);
              }}
            />
            <Label htmlFor={`oot-shipped-${event.id}`}>
              Produto suspeito foi expedido?
            </Label>
          </div>
          {suspectShipped ? (
            <div className="flex items-center gap-2 pl-6">
              <Checkbox
                id={`oot-notified-${event.id}`}
                checked={customerNotified}
                onCheckedChange={(checked) =>
                  setCustomerNotified(checked === true)
                }
              />
              <Label htmlFor={`oot-notified-${event.id}`}>
                Clientes afetados foram notificados?
              </Label>
            </div>
          ) : null}
        </div>

        <Button
          type="submit"
          disabled={!canSubmit}
          className={ACTION_BUTTON_CLASS}
        >
          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
          {mutation.isPending ? "Registrando…" : "Registrar avaliação"}
        </Button>
      </form>
    </Panel>
  );
}

function OotAssessmentRecord({ event }: { event: OotEvent }) {
  const meta = event.assessmentDecision
    ? DECISION_META[event.assessmentDecision]
    : null;

  const period =
    event.assessmentPeriodStart || event.assessmentPeriodEnd
      ? `${formatDate(event.assessmentPeriodStart)} — ${formatDate(event.assessmentPeriodEnd)}`
      : "—";

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Qualidade"
        title="Avaliação de impacto registrada"
        description={
          <>
            Reprovado como recebido na calibração{" "}
            <span className="font-mono tabular-nums">
              {event.jobIdentifier}
            </span>{" "}
            ({formatDate(event.detectedAt)}) — ISO 9001 §7.1.5.2.
          </>
        }
      />
      <div className="mt-4 space-y-4">
        {meta ? <StatusPill tone={meta.tone}>{meta.label}</StatusPill> : null}

        {event.assessmentRationale ? (
          <p className="text-muted-foreground text-sm leading-6 text-pretty">
            {event.assessmentRationale}
          </p>
        ) : null}

        <BlueprintGrid className="sm:grid-cols-2">
          <BlueprintField label="Período afetado" mono>
            {period}
          </BlueprintField>
          <BlueprintField label="Produto suspeito expedido">
            {yesNo(event.assessmentSuspectShipped)}
          </BlueprintField>
          <BlueprintField label="Clientes notificados">
            {yesNo(event.assessmentCustomerNotified)}
          </BlueprintField>
          <BlueprintField label="Registro" mono>
            {formatDate(event.assessmentCreatedAt)}
          </BlueprintField>
        </BlueprintGrid>

        <p className="text-muted-foreground text-xs">
          Registrado por {event.assessmentBy ?? "—"} em{" "}
          {formatDate(event.assessmentCreatedAt)}.
        </p>
      </div>
    </Panel>
  );
}
