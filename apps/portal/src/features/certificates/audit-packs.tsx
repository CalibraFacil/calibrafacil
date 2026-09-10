import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download04Icon, FolderZipIcon } from "@hugeicons/core-free-icons";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateRangePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Panel, PanelHeader } from "@/components/instrument-panel";
import { StatusPill } from "@/components/status-pill";
import type { SignalTone } from "@/components/instrument-panel";
import { usePortalUnits } from "@/features/fleet/queries";
import { getApiBaseUrl } from "@/lib/utils";

type AuditPackStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export type AuditPack = {
  id: number;
  status: AuditPackStatus;
  dateFrom: string;
  dateTo: string;
  unitId: number | null;
  unitName: string | null;
  include: {
    certificates: boolean;
    fleetReport: boolean;
    verificationIndex: boolean;
  };
  certificateCount: number | null;
  fileSizeBytes: number | null;
  expiresAt: string | null;
  expired: boolean;
  completedAt: string | null;
  createdAt: string;
};

type AuditPacksResponse = { data: Array<AuditPack> };

type AuditPackRequest = {
  dateFrom: string;
  dateTo: string;
  unitId?: number;
  include: AuditPack["include"];
};

const AUDIT_PACKS_QUERY_KEY = ["portal-audit-packs"];

function isInFlight(pack: AuditPack): boolean {
  return pack.status === "PENDING" || pack.status === "PROCESSING";
}

export function useAuditPacks() {
  return useQuery({
    queryKey: AUDIT_PACKS_QUERY_KEY,
    queryFn: async (): Promise<AuditPacksResponse> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/audit-packs`,
        {
          credentials: "include",
        },
      );
      if (!response.ok) {
        throw new Error("Falha ao carregar pacotes de auditoria");
      }
      return response.json();
    },
    // The pack is generated asynchronously — poll while one is in flight so
    // the row flips to "Pronto" without a manual refresh.
    refetchInterval: (query) =>
      query.state.data?.data.some(isInFlight) ? 5_000 : false,
  });
}

async function readErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body) {
      const message = Object.fromEntries(Object.entries(body)).error;
      if (typeof message === "string" && message) return message;
    }
  } catch {
    // Non-JSON error body — use the fallback.
  }
  return fallback;
}

function toDateParam(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPeriod(dateFrom: string, dateTo: string): string {
  const br = (value: string) => {
    const [year, month, day] = value.split("-");
    return year && month && day ? `${day}/${month}/${year}` : value;
  };
  return `${br(dateFrom)} – ${br(dateTo)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function defaultDateRange(): DateRange {
  const to = new Date();
  const from = new Date();
  from.setFullYear(from.getFullYear() - 1);
  return { from, to };
}

const STATUS_PILL: Record<
  AuditPackStatus,
  { label: string; tone: SignalTone; pulse?: boolean }
> = {
  PENDING: { label: "Preparando", tone: "info", pulse: true },
  PROCESSING: { label: "Preparando", tone: "info", pulse: true },
  COMPLETED: { label: "Pronto", tone: "ok" },
  FAILED: { label: "Falhou", tone: "critical" },
};

function AuditPackDownloadButton({ pack }: { pack: AuditPack }) {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/audit-packs/${pack.id}/download`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Falha ao baixar o pacote."),
        );
      }
      const { url, filename } = await response.json();
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao baixar o pacote.",
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={isDownloading}
    >
      {isDownloading ? (
        <Spinner className="size-4" />
      ) : (
        <HugeiconsIcon icon={Download04Icon} className="size-4" />
      )}
      Baixar ZIP
    </Button>
  );
}

function AuditPackDialog() {
  const queryClient = useQueryClient();
  const unitsQuery = usePortalUnits();
  const units = unitsQuery.data?.units ?? [];
  const showUnitFilter = units.length > 1;

  const [open, setOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    defaultDateRange,
  );
  const [unitId, setUnitId] = useState<number | null>(null);
  const [includeCertificates, setIncludeCertificates] = useState(true);
  const [includeFleetReport, setIncludeFleetReport] = useState(true);
  const [includeVerificationIndex, setIncludeVerificationIndex] =
    useState(true);

  const requestMutation = useMutation({
    mutationFn: async (body: AuditPackRequest) => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/audit-packs`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Falha ao solicitar o pacote."),
        );
      }
      return response.json();
    },
    onSuccess: async () => {
      setOpen(false);
      toast.success(
        "Pacote em preparação. Você receberá um e-mail quando estiver pronto.",
      );
      await queryClient.invalidateQueries({ queryKey: AUDIT_PACKS_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Falha ao solicitar o pacote.",
      );
    },
  });

  const hasContent =
    includeCertificates || includeFleetReport || includeVerificationIndex;
  const canSubmit =
    Boolean(dateRange?.from && dateRange?.to) &&
    hasContent &&
    !requestMutation.isPending;

  const handleSubmit = () => {
    if (!dateRange?.from || !dateRange.to) return;
    requestMutation.mutate({
      dateFrom: toDateParam(dateRange.from),
      dateTo: toDateParam(dateRange.to),
      ...(unitId !== null ? { unitId } : {}),
      include: {
        certificates: includeCertificates,
        fleetReport: includeFleetReport,
        verificationIndex: includeVerificationIndex,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <HugeiconsIcon icon={FolderZipIcon} className="size-4" />
            Gerar pacote de auditoria
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pacote de auditoria</DialogTitle>
          <DialogDescription>
            Exporte em um único ZIP os certificados do período, o relatório de
            situação da frota e o índice com links de verificação — pronto para
            apresentar em auditorias.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Período (data de aprovação)</Label>
            <DateRangePicker
              value={dateRange}
              onChange={setDateRange}
              placeholder="Selecione o período"
            />
          </div>

          {showUnitFilter && (
            <div className="space-y-2">
              <Label htmlFor="audit-pack-unit">Unidade</Label>
              <select
                id="audit-pack-unit"
                value={unitId === null ? "" : String(unitId)}
                onChange={(event) => {
                  const value = event.target.value;
                  setUnitId(value ? Number.parseInt(value, 10) : null);
                }}
                className="border-input bg-transparent h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none"
              >
                <option value="">Todas as unidades</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Conteúdo</Label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={includeCertificates}
                  onCheckedChange={(checked) =>
                    setIncludeCertificates(checked === true)
                  }
                />
                Certificados (PDF)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={includeFleetReport}
                  onCheckedChange={(checked) =>
                    setIncludeFleetReport(checked === true)
                  }
                />
                Relatório de situação da frota (PDF + XLSX)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={includeVerificationIndex}
                  onCheckedChange={(checked) =>
                    setIncludeVerificationIndex(checked === true)
                  }
                />
                Índice com links de verificação
              </label>
            </div>
            {!hasContent && (
              <p className="text-destructive text-xs">
                Selecione ao menos um conteúdo para o pacote.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={requestMutation.isPending}
          >
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {requestMutation.isPending && <Spinner className="size-4" />}
            Gerar pacote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuditPackRow({ pack }: { pack: AuditPack }) {
  const pill: { label: string; tone: SignalTone; pulse?: boolean } =
    pack.expired
      ? { label: "Expirado", tone: "neutral" }
      : STATUS_PILL[pack.status];

  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm tabular-nums">
            {formatPeriod(pack.dateFrom, pack.dateTo)}
          </span>
          <StatusPill tone={pill.tone} pulse={pill.pulse} size="sm">
            {pill.label}
          </StatusPill>
        </div>
        <p className="text-muted-foreground text-xs">
          {pack.unitName ? `${pack.unitName} · ` : ""}
          {pack.status === "COMPLETED" && pack.certificateCount !== null
            ? `${pack.certificateCount} certificado(s)`
            : null}
          {pack.status === "COMPLETED" && pack.fileSizeBytes
            ? ` · ${formatBytes(pack.fileSizeBytes)}`
            : null}
          {pack.status === "FAILED"
            ? "Não foi possível gerar o pacote. Tente novamente."
            : null}
          {isInFlight(pack)
            ? "Preparando pacote… Você receberá um e-mail quando estiver pronto."
            : null}
          {pack.expired
            ? "Download expirado. Gere um novo pacote se necessário."
            : null}
        </p>
      </div>
      {pack.status === "COMPLETED" && !pack.expired && (
        <AuditPackDownloadButton pack={pack} />
      )}
    </div>
  );
}

/**
 * Audit-pack section of the certificates page: request dialog + the list of
 * recent packs with live status (polls while a pack is being generated).
 */
export function AuditPacksPanel() {
  const { data } = useAuditPacks();
  const packs = data?.data ?? [];

  return (
    <Panel className="p-4 sm:p-6">
      <PanelHeader
        title="Pacote de auditoria"
        description="Todos os certificados do período + situação da frota em um único ZIP, com links públicos de verificação."
        action={<AuditPackDialog />}
      />
      {packs.length > 0 && (
        <div className="divide-border mt-2 divide-y">
          {packs.map((pack) => (
            <AuditPackRow key={pack.id} pack={pack} />
          ))}
        </div>
      )}
    </Panel>
  );
}
