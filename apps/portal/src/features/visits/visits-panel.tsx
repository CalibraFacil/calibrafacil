import { Link } from "@tanstack/react-router";
import { Location01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  Panel,
  PanelHeader,
  type SignalTone,
} from "@/components/instrument-panel";
import { StatusPill } from "@/components/status-pill";
import { formatDateLong } from "@/lib/format";
import {
  formatPortalVisitAddress,
  PORTAL_VISIT_STATUS_LABELS,
  usePortalVisits,
  type PortalVisit,
  type PortalVisitStatus,
} from "./queries";

const VISIT_TONE: Record<PortalVisitStatus, SignalTone> = {
  PROPOSED: "warning",
  CONFIRMED: "info",
  IN_PROGRESS: "info",
  COMPLETED: "ok",
  CANCELLED: "neutral",
};

function scheduledLabel(scheduledAt: string | null): string {
  if (!scheduledAt) return "Data a confirmar";
  return formatDateLong(new Date(scheduledAt));
}

function VisitRow({ visit }: { visit: PortalVisit }) {
  const addressText = formatPortalVisitAddress(visit.address);
  const assetLabel =
    visit.assetCount === 1
      ? "1 instrumento"
      : `${visit.assetCount} instrumentos`;

  const body = (
    <>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {scheduledLabel(visit.scheduledAt)}
        </p>
        <p className="text-muted-foreground truncate font-mono text-xs tabular-nums">
          {assetLabel}
          {visit.technicianName ? ` · ${visit.technicianName}` : ""}
          {addressText ? ` · ${addressText}` : ""}
        </p>
      </div>
      <StatusPill tone={VISIT_TONE[visit.status]} size="sm">
        {PORTAL_VISIT_STATUS_LABELS[visit.status]}
      </StatusPill>
    </>
  );

  if (visit.sourceRequestId) {
    return (
      <Link
        to="/requests/$id"
        params={{ id: String(visit.sourceRequestId) }}
        className="hover:bg-muted/60 flex items-center justify-between gap-3 rounded-lg p-2 transition-colors"
      >
        {body}
      </Link>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg p-2">
      {body}
    </div>
  );
}

/**
 * Customer-facing tracking for on-site (em loco) visits. Renders nothing when
 * the customer has no scheduled visits, so dropoff-only clients see no noise.
 */
export function PortalVisitsPanel() {
  const { data, isLoading } = usePortalVisits();
  const visits = data?.data ?? [];

  if (!isLoading && visits.length === 0) return null;

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="No local"
        title="Próximas visitas"
        description="Visitas de calibração in loco agendadas para você."
      />
      <div className="mt-4 space-y-1">
        {isLoading && visits.length === 0 ? (
          <div className="bg-muted/45 text-muted-foreground flex items-center gap-2 rounded-xl p-4 text-sm shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
            <HugeiconsIcon icon={Location01Icon} strokeWidth={2} />
            Carregando visitas…
          </div>
        ) : (
          visits.map((visit) => <VisitRow key={visit.id} visit={visit} />)
        )}
      </div>
    </Panel>
  );
}
