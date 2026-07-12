import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon, File01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/status-pill";
import {
  ACTION_BUTTON_CLASS,
  BlueprintField,
  BlueprintGrid,
  Panel,
  PanelHeader,
  type SignalTone,
} from "@/components/instrument-panel";
import { getApiBaseUrl } from "@/lib/utils";
import { useIntervalInsight } from "./queries";
import type { IntervalInsight } from "./types";

const CLASSIFICATION_META: Record<
  IntervalInsight["classification"],
  { label: string; tone: SignalTone }
> = {
  STABLE: { label: "Estável", tone: "ok" },
  DRIFTING: { label: "Derivando", tone: "warning" },
  INSUFFICIENT_DATA: { label: "Dados insuficientes", tone: "neutral" },
};

const ACTION_LABEL: Record<
  NonNullable<IntervalInsight["recommendation"]>["action"],
  string
> = { extend: "Estender", keep: "Manter", shorten: "Encurtar" };

function monthsLabel(months: number): string {
  return `${months} ${months === 1 ? "mês" : "meses"}`;
}

/**
 * Read-only reliability-based interval analysis (ILAC-G24 / NCSL RP-1). It only
 * SUGGESTS — the customer applies via the editor panel (§7.8.4.3). Regime-agnostic: a
 * legal-metrology asset is analyzed like any other; its regulation-fixed verification
 * periodicity is a separate, read-only track (see the legal-verification panel).
 */
export function IntervalInsightPanel({
  assetId,
  currentIntervalMonths,
}: {
  assetId: number;
  currentIntervalMonths: number | null;
}) {
  const queryClient = useQueryClient();
  const query = useIntervalInsight(assetId);
  const insight = query.data;
  const [confirmOpen, setConfirmOpen] = useState(false);

  // REQ-ENGINE-APPLY: apply the suggestion (writes engine_applied + an auditable
  // rationale citing the method). The customer confirming in the dialog IS their
  // agreement — the dialog exists so the current → proposed change is explicit.
  const applyMutation = useMutation({
    mutationFn: async () => {
      const recommendation = insight?.recommendation;
      if (!recommendation) return;
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/assets/${assetId}/interval`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            intervalMonths: recommendation.proposedIntervalMonths,
            rationale: `Sugestão do motor de confiabilidade (ILAC-G24 / NCSL RP-1) aplicada — ${insight?.classification}, método ${recommendation.method}.`,
            source: "engine",
          }),
        },
      );
      if (!response.ok) {
        throw new Error("Não foi possível aplicar a sugestão.");
      }
    },
    onSuccess: () => {
      setConfirmOpen(false);
      toast.success("Periodicidade atualizada a partir da sugestão.");
      queryClient.invalidateQueries({ queryKey: ["portal-asset"] });
      queryClient.invalidateQueries({ queryKey: ["portal-interval-insight"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Programa metrológico"
        title="Análise de periodicidade"
        description="Sugestão baseada no histórico de calibração (ILAC-G24 / NCSL RP-1). Apenas indicativo — você decide."
      />
      <div className="mt-4 space-y-4">
        {query.isPending ? (
          <>
            <Skeleton className="h-6 w-28 rounded-full" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </>
        ) : query.isError || !insight ? (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm text-pretty">
              Não foi possível carregar a análise de periodicidade.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              className={ACTION_BUTTON_CLASS}
            >
              Tentar novamente
            </Button>
          </div>
        ) : (
          <InsightBody
            insight={insight}
            assetId={assetId}
            currentIntervalMonths={currentIntervalMonths}
            confirmOpen={confirmOpen}
            onConfirmOpenChange={setConfirmOpen}
            applyPending={applyMutation.isPending}
            onApply={() => applyMutation.mutate()}
          />
        )}
      </div>
    </Panel>
  );
}

function InsightBody({
  insight,
  assetId,
  currentIntervalMonths,
  confirmOpen,
  onConfirmOpenChange,
  applyPending,
  onApply,
}: {
  insight: IntervalInsight;
  assetId: number;
  currentIntervalMonths: number | null;
  confirmOpen: boolean;
  onConfirmOpenChange: (open: boolean) => void;
  applyPending: boolean;
  onApply: () => void;
}) {
  const meta = CLASSIFICATION_META[insight.classification];
  const recommendation = insight.recommendation;

  return (
    <>
      <StatusPill tone={meta.tone}>{meta.label}</StatusPill>

      {insight.reliability !== null ? (
        <BlueprintGrid className="sm:grid-cols-2">
          <BlueprintField label="Confiabilidade" mono>
            {(insight.reliability * 100).toFixed(0)}%
          </BlueprintField>
          <BlueprintField label="Cobertura" mono>
            {(insight.coverage * 100).toFixed(0)}%
          </BlueprintField>
        </BlueprintGrid>
      ) : null}

      {recommendation ? (
        <div className="bg-muted/45 rounded-xl p-4 text-sm shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
          Sugestão:{" "}
          <strong>
            {ACTION_LABEL[recommendation.action]} para{" "}
            {monthsLabel(recommendation.proposedIntervalMonths)}
          </strong>
          .
          {recommendation.action === "keep" ? (
            " A periodicidade atual já está adequada."
          ) : (
            <div className="mt-3">
              <Dialog open={confirmOpen} onOpenChange={onConfirmOpenChange}>
                <Button
                  size="sm"
                  onClick={() => onConfirmOpenChange(true)}
                  className={ACTION_BUTTON_CLASS}
                >
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
                  Aplicar sugestão
                </Button>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Aplicar a sugestão do motor?</DialogTitle>
                    <DialogDescription>
                      A periodicidade de calibração deste instrumento será
                      alterada e a mudança fica registrada no histórico com a
                      justificativa do motor de confiabilidade (ILAC-G24 / NCSL
                      RP-1).
                    </DialogDescription>
                  </DialogHeader>
                  <BlueprintGrid className="grid-cols-2">
                    <BlueprintField label="Atual" mono>
                      {currentIntervalMonths != null
                        ? monthsLabel(currentIntervalMonths)
                        : "—"}
                    </BlueprintField>
                    <BlueprintField label="Proposta" mono>
                      {monthsLabel(recommendation.proposedIntervalMonths)}
                    </BlueprintField>
                  </BlueprintGrid>
                  <DialogFooter>
                    <DialogClose
                      render={
                        <Button
                          variant="outline"
                          className={ACTION_BUTTON_CLASS}
                        />
                      }
                    >
                      Cancelar
                    </DialogClose>
                    <Button
                      onClick={onApply}
                      disabled={applyPending}
                      className={ACTION_BUTTON_CLASS}
                    >
                      {applyPending ? "Aplicando…" : "Confirmar alteração"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
          <p className="text-muted-foreground mt-3 text-xs">
            Método{" "}
            <span className="font-mono tabular-nums">
              {recommendation.method}
            </span>
            {recommendation.reliabilityBound !== null
              ? ` · meta de confiabilidade ${(recommendation.reliabilityBound * 100).toFixed(0)}%`
              : null}
          </p>
        </div>
      ) : insight.classification === "INSUFFICIENT_DATA" ? (
        <p className="text-muted-foreground text-sm text-pretty">
          Histórico insuficiente para uma sugestão (mín. 3 calibrações com dados
          de conformidade).
        </p>
      ) : null}

      <div>
        <Button
          variant="ghost"
          size="sm"
          render={
            <a
              href={`${getApiBaseUrl()}/api/portal/assets/${assetId}/interval-insight/report`}
              target="_blank"
              rel="noopener noreferrer"
            />
          }
          className={ACTION_BUTTON_CLASS}
        >
          <HugeiconsIcon icon={File01Icon} strokeWidth={2} />
          Baixar relatório
        </Button>
      </div>
    </>
  );
}
