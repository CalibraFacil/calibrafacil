import { Link, useLocation } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { CommandMenu } from "@/components/command-menu";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { shortcutLabel } from "@/lib/platform";

// Breadcrumbs are built from the URL path (not route matches) so a crumb's
// parent always appears even when a section has no layout route.tsx — e.g.
// /certificates/$id still shows "Certificados" as its parent.

// Label for a known static path segment.
const SEGMENT_LABELS: Record<string, string> = {
  assets: "Equipamentos",
  certificates: "Certificados",
  requests: "Solicitações",
  "service-orders": "Manutenção",
  settings: "Configurações",
  appearance: "Aparência",
  new: "Nova solicitação",
};

// Label for a dynamic detail segment (an id), keyed by its parent collection.
const DETAIL_LABELS: Record<string, string> = {
  assets: "Equipamento",
  certificates: "Certificado",
  requests: "Solicitação",
  "service-orders": "Ordem de serviço",
};

function formatRouteSegment(segment: string) {
  return segment
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function PortalHeader() {
  const { pathname } = useLocation();
  const [commandOpen, setCommandOpen] = useState(false);

  useMountEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const breadcrumbs = useMemo(() => {
    const segments = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    const crumbs: Array<{ label: string; path: string }> = [
      { label: "Painel", path: "/" },
    ];

    let acc = "";
    segments.forEach((segment, index) => {
      acc += `/${segment}`;
      const parent = index > 0 ? segments[index - 1] : "";

      let label: string;
      if (SEGMENT_LABELS[segment]) {
        label = SEGMENT_LABELS[segment];
      } else if (parent && DETAIL_LABELS[parent]) {
        label = DETAIL_LABELS[parent];
      } else {
        label = formatRouteSegment(segment);
      }

      crumbs.push({ label, path: acc });
    });

    return crumbs;
  }, [pathname]);

  return (
    <header className="bg-background/80 sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4 backdrop-blur-sm">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-1 h-8" />
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <Fragment key={crumb.path}>
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink render={<Link to={crumb.path} />}>
                        {crumb.label}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {!isLast && <BreadcrumbSeparator />}
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="border-border bg-background text-muted-foreground hover:bg-muted hidden h-9 w-64 items-center gap-2 rounded-lg border px-3 text-sm shadow-xs transition-[background-color,box-shadow] active:scale-[0.98] sm:flex"
      >
        <HugeiconsIcon icon={Search01Icon} className="size-4" strokeWidth={2} />
        <span className="flex-1 text-left">Buscar…</span>
        <kbd className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-medium">
          {shortcutLabel("K")}
        </kbd>
      </button>

      <Button
        variant="outline"
        size="icon-sm"
        className="sm:hidden"
        aria-label="Buscar"
        onClick={() => setCommandOpen(true)}
      >
        <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
      </Button>

      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </header>
  );
}
