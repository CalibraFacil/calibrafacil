import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Alert02Icon,
  ArrowRight01Icon,
  File01Icon,
  Home01Icon,
  Notebook01Icon,
  Search01Icon,
  ToolsIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

import { cn } from "@/lib/utils";
import { getApiBaseUrl } from "@/lib/utils";
import { getCalibrationStatus } from "@/lib/calibration-status";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { StatusPill } from "@/components/status-pill";

type AssetHit = {
  id: number;
  publicId: string;
  name: string;
  tag: string;
  serialNumber: string;
  nextCalibrationDate: string | null;
};

type CertificateHit = {
  id: number;
  jobId: string;
  assetName: string;
  assetTag: string;
};

async function searchEntity<T>(path: string, query: string): Promise<Array<T>> {
  const params = new URLSearchParams({ query, page: "1", limit: "5" });
  const response = await fetch(
    `${getApiBaseUrl()}/api/portal/${path}?${params.toString()}`,
    { credentials: "include" },
  );
  if (!response.ok) return [];
  const body = await response.json();
  return Array.isArray(body?.data) ? body.data : [];
}

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const term = query.trim();
  const isSearching = term.length >= 2;

  const { data: assets = [] } = useQuery({
    queryKey: ["cmd-assets", term],
    enabled: open && isSearching,
    queryFn: () => searchEntity<AssetHit>("assets", term),
    staleTime: 30_000,
  });

  const { data: certificates = [] } = useQuery({
    queryKey: ["cmd-certificates", term],
    enabled: open && isSearching,
    queryFn: () => searchEntity<CertificateHit>("certificates", term),
    staleTime: 30_000,
  });

  function run(action: () => void) {
    onOpenChange(false);
    setQuery("");
    action();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="overflow-hidden p-0 sm:max-w-xl"
      >
        <Command
          shouldFilter={false}
          label="Buscar no portal"
          className="flex flex-col"
        >
          <div className="border-border/70 flex items-center gap-2.5 border-b px-4">
            <HugeiconsIcon
              icon={Search01Icon}
              className="text-muted-foreground size-4 shrink-0"
              strokeWidth={2}
            />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Buscar equipamentos, certificados, solicitações…"
              className="placeholder:text-muted-foreground h-12 w-full bg-transparent text-sm outline-none"
            />
            <kbd className="text-muted-foreground bg-muted hidden rounded px-1.5 py-0.5 text-[10px] font-medium sm:inline-block">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-[60vh] overflow-y-auto overflow-x-hidden p-2">
            {isSearching ? (
              <Command.Empty className="text-muted-foreground py-8 text-center text-sm">
                Nenhum resultado para “{term}”.
              </Command.Empty>
            ) : null}

            {!isSearching ? (
              <>
                <Group heading="Ir para">
                  <Item
                    icon={Home01Icon}
                    label="Painel"
                    onSelect={() => run(() => navigate({ to: "/" }))}
                  />
                  <Item
                    icon={Wrench01Icon}
                    label="Equipamentos"
                    onSelect={() => run(() => navigate({ to: "/assets" }))}
                  />
                  <Item
                    icon={File01Icon}
                    label="Certificados"
                    onSelect={() =>
                      run(() => navigate({ to: "/certificates" }))
                    }
                  />
                  <Item
                    icon={Notebook01Icon}
                    label="Solicitações"
                    onSelect={() => run(() => navigate({ to: "/requests" }))}
                  />
                  <Item
                    icon={ToolsIcon}
                    label="Manutenção"
                    onSelect={() =>
                      run(() => navigate({ to: "/service-orders" }))
                    }
                  />
                  <Item
                    icon={Alert02Icon}
                    label="Fora de tolerância"
                    onSelect={() =>
                      run(() => navigate({ to: "/out-of-tolerance" }))
                    }
                  />
                </Group>
                <Group heading="Ações">
                  <Item
                    icon={Add01Icon}
                    label="Nova solicitação de calibração"
                    onSelect={() =>
                      run(() => navigate({ to: "/requests/new" }))
                    }
                  />
                </Group>
              </>
            ) : null}

            {isSearching && assets.length > 0 ? (
              <Group heading="Equipamentos">
                {assets.map((asset) => {
                  const status = getCalibrationStatus(
                    asset.nextCalibrationDate,
                  );
                  return (
                    <Item
                      key={`asset-${asset.id}`}
                      icon={Wrench01Icon}
                      label={asset.name}
                      hint={`${asset.tag} · ${asset.serialNumber}`}
                      monoHint
                      trailing={
                        <StatusPill tone={status.tone} size="sm">
                          {status.label}
                        </StatusPill>
                      }
                      onSelect={() =>
                        run(() =>
                          navigate({
                            to: "/assets/$id",
                            params: { id: asset.publicId },
                          }),
                        )
                      }
                    />
                  );
                })}
              </Group>
            ) : null}

            {isSearching && certificates.length > 0 ? (
              <Group heading="Certificados">
                {certificates.map((certificate) => (
                  <Item
                    key={`cert-${certificate.id}`}
                    icon={File01Icon}
                    label={certificate.jobId}
                    monoLabel
                    hint={`${certificate.assetName} · ${certificate.assetTag}`}
                    onSelect={() =>
                      run(() =>
                        navigate({
                          to: "/certificates/$id",
                          params: { id: certificate.jobId },
                        }),
                      )
                    }
                  />
                ))}
              </Group>
            ) : null}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function Group({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <Command.Group
      heading={heading}
      className="text-muted-foreground [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em]"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  icon,
  label,
  hint,
  monoLabel = false,
  monoHint = false,
  trailing,
  onSelect,
}: {
  icon: IconSvgElement;
  label: string;
  hint?: string;
  /** Render the label as a console identifier (font-mono tabular-nums). */
  monoLabel?: boolean;
  /** Render the hint as a console identifier (font-mono tabular-nums). */
  monoHint?: boolean;
  trailing?: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={`${label} ${hint ?? ""}`}
      onSelect={onSelect}
      className={cn(
        "group flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm",
        "data-[selected=true]:bg-muted",
      )}
    >
      <span className="bg-muted text-muted-foreground group-data-[selected=true]:bg-background flex size-8 shrink-0 items-center justify-center rounded-lg">
        <HugeiconsIcon icon={icon} className="size-4" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate font-medium",
            monoLabel && "font-mono tabular-nums",
          )}
        >
          {label}
        </p>
        {hint ? (
          <p
            className={cn(
              "text-muted-foreground truncate text-xs",
              monoHint && "font-mono tabular-nums",
            )}
          >
            {hint}
          </p>
        ) : null}
      </div>
      {trailing ?? (
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className="text-muted-foreground/0 size-4 shrink-0 transition-colors group-data-[selected=true]:text-muted-foreground"
        />
      )}
    </Command.Item>
  );
}
