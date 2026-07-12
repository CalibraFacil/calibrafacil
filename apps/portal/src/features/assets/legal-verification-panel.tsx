import { HugeiconsIcon } from "@hugeicons/react";
import { Calendar03Icon } from "@hugeicons/core-free-icons";

import { Panel, PanelHeader } from "@/components/instrument-panel";
import { formatDate } from "@/lib/format";
import type { AssetDetail } from "./types";

/**
 * Track 2 — the regulation-fixed legal-metrology VERIFICATION periodicity (read-only),
 * shown only for LEGAL instruments and INDEPENDENT of the customer-owned calibration
 * interval. The date is INDICATIVE when the Ipem runs the cadence
 * (operationalizedByDelegate) and absent for `not_nationally_fixed` (REQ-MLR-060/061/062).
 */
export function LegalVerificationPanel({ asset }: { asset: AssetDetail }) {
  if (asset.metrologyRegime !== "LEGAL") return null;
  const regulated = asset.regulatedInterval;
  const noNationalPeriod =
    !regulated ||
    regulated.kind === "not_nationally_fixed" ||
    !asset.nextLegalVerificationDate;
  const indicative = regulated?.operationalizedByDelegate ?? false;

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Metrologia legal"
        title="Verificação — metrologia legal"
        description="Periodicidade fixada por regulamento (Inmetro / RBMLQ-I) — definida pela regulamentação, não editável."
      />
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={Calendar03Icon}
            className="text-muted-foreground size-4 shrink-0"
            strokeWidth={2}
          />
          <span className="text-sm">
            Próxima verificação:{" "}
            <span className="font-mono tabular-nums">
              {noNationalPeriod
                ? "sem periodicidade nacional fixada"
                : formatDate(asset.nextLegalVerificationDate)}
            </span>
          </span>
        </div>
        {indicative && !noNationalPeriod ? (
          <p className="text-muted-foreground text-xs text-pretty">
            Cadência operacionalizada pelo Ipem — data indicativa, não é prazo
            nacional fixo.
          </p>
        ) : null}
        {regulated ? (
          <p className="text-muted-foreground text-xs text-pretty">
            {regulated.regulationReference}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
