import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Calendar03Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@calibra-facil/ui/button";
import { Input } from "@calibra-facil/ui/input";
import { Label } from "@calibra-facil/ui/label";
import { Textarea } from "@calibra-facil/ui/textarea";
import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
} from "@calibra-facil/ui/instrument-panel";
import { portalIntervalUpdateResponseSchema } from "@calibra-facil/contracts";
import { fetchPortalJson, jsonInit } from "@/lib/api-fetch";
import { usePortalQueryKey } from "@/lib/portal-org-context";
import type { AssetDetail } from "./types";

/**
 * Customer-owned calibration interval (periodicity) editor. The interval is the
 * equipment owner's decision, not the lab's (ISO/IEC 17025:2017 §7.8.4.3 +
 * ILAC-G24 / OIML D 10), for EVERY regime — there is no legal-metrology lock (a legal
 * instrument's regulation-fixed verification periodicity is shown by
 * LegalVerificationPanel). The customer sets months + a mandatory rationale (the §7.5
 * technical record); submission is blocked without it (REQ-INTERVAL-040/041).
 */
export function IntervalEditorPanel({ asset }: { asset: AssetDetail }) {
  const queryClient = useQueryClient();
  const key = usePortalQueryKey();
  const [months, setMonths] = useState(
    asset.calibrationIntervalMonths != null
      ? String(asset.calibrationIntervalMonths)
      : "",
  );
  const [rationale, setRationale] = useState("");

  const mutation = useMutation({
    mutationFn: async (input: {
      intervalMonths: number;
      rationale: string;
    }) => {
      await fetchPortalJson(
        `/api/portal/assets/${asset.id}/interval`,
        portalIntervalUpdateResponseSchema,
        {
          errorMessage: "Não foi possível salvar a periodicidade.",
          init: jsonInit("PUT", input),
        },
      );
    },
    onSuccess: () => {
      toast.success("Periodicidade atualizada.");
      setRationale("");
      queryClient.invalidateQueries({ queryKey: key("portal-asset") });
      queryClient.invalidateQueries({ queryKey: key("portal-assets") });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // REQ-MLR-040: the customer owns the calibration interval for EVERY regime — there is
  // no legal-metrology lock here. A legal instrument's regulation-fixed verification
  // periodicity is shown separately by LegalVerificationPanel (read-only).
  const monthsValue = Number(months);
  const monthsValid =
    Number.isInteger(monthsValue) && monthsValue >= 1 && monthsValue <= 120;
  const canSubmit =
    monthsValid && rationale.trim().length > 0 && !mutation.isPending;

  const currentLabel =
    asset.calibrationIntervalMonths != null
      ? `${asset.calibrationIntervalMonths} ${asset.calibrationIntervalMonths === 1 ? "mês" : "meses"} · definida por você`
      : "aguardando definição do cliente";

  return (
    <Panel className="p-5">
      <PanelHeader
        title="Periodicidade de calibração"
        description="Você define com que frequência este instrumento deve ser recalibrado — o laboratório não atribui periodicidade."
      />
      <div className="mt-4 space-y-4">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={Calendar03Icon}
            className="text-muted-foreground size-4 shrink-0"
            strokeWidth={2}
          />
          <span className="text-sm">
            Atual:{" "}
            <span className="font-mono tabular-nums">{currentLabel}</span>
          </span>
        </div>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            mutation.mutate({
              intervalMonths: monthsValue,
              rationale: rationale.trim(),
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="interval-months">Intervalo (meses)</Label>
            <Input
              id="interval-months"
              type="number"
              inputMode="numeric"
              min={1}
              max={120}
              value={months}
              onChange={(event) => setMonths(event.target.value)}
              placeholder="Ex.: 12"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="interval-rationale">Justificativa</Label>
            <Textarea
              id="interval-rationale"
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              placeholder="Motivo (histórico de estabilidade, recomendação do fabricante, intensidade de uso…)."
              rows={3}
            />
            <p className="text-muted-foreground text-xs text-pretty">
              A justificativa fica registrada no histórico do equipamento.
            </p>
          </div>
          <Button
            type="submit"
            disabled={!canSubmit}
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
            {mutation.isPending ? "Salvando…" : "Salvar periodicidade"}
          </Button>
        </form>
      </div>
    </Panel>
  );
}
