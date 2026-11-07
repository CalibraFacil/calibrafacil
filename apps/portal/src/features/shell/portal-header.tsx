import { Link, useLocation } from "@tanstack/react-router";
import { skipToken, useQuery } from "@tanstack/react-query";
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
} from "@calibra-facil/ui/breadcrumb";
import { Button } from "@calibra-facil/ui/button";
import { Separator } from "@calibra-facil/ui/separator";
import { SidebarTrigger } from "@calibra-facil/ui/sidebar";
import { CommandMenu } from "@/features/shell/command-menu";
import { NotificationBell } from "@/features/notifications/notification-bell";
import { useMountEffect } from "@calibra-facil/ui/use-mount-effect";
import { shortcutLabel } from "@/lib/platform";
import { usePortalKeys } from "@/lib/portal-keys";
import { routeCrumbs } from "@/lib/route-registry";

// Breadcrumbs are built from the URL path (not route matches) so a crumb's
// parent always appears even when a section has no layout route.tsx — e.g.
// /certificates/$id still shows "Certificados" as its parent. Each crumb is
// titled by the route registry (`routeCrumbs`).

export function PortalHeader() {
  const { pathname } = useLocation();
  const [commandOpen, setCommandOpen] = useState(false);

  // On an asset detail page the trailing crumb shows the instrument's name
  // instead of a generic "Equipamento". The URL id is opaque (publicId), so the
  // name comes from the page's own query cache: same key, skipToken — the
  // header never fetches, it only mirrors what the page already loaded.
  const assetParam = /^\/assets\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const keys = usePortalKeys();
  const assetCrumbQuery = useQuery<{ name?: string }>({
    queryKey: keys.asset(assetParam ?? "__none__"),
    queryFn: skipToken,
  });
  const assetName = assetParam ? assetCrumbQuery.data?.name : undefined;

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

  const breadcrumbs = useMemo(
    () =>
      routeCrumbs(pathname).map((crumb) =>
        assetName && crumb.path === `/assets/${assetParam}`
          ? { ...crumb, title: assetName }
          : crumb,
      ),
    [pathname, assetName, assetParam],
  );

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
                      <BreadcrumbPage className="max-w-[18rem] truncate">
                        {crumb.title}
                      </BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink render={<Link to={crumb.path} />}>
                        {crumb.title}
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

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="border-border bg-background text-muted-foreground hover:bg-muted hidden h-9 w-64 items-center gap-2 rounded-lg border px-3 text-sm shadow-xs transition-[background-color,box-shadow] active:scale-[0.98] sm:flex"
        >
          <HugeiconsIcon
            icon={Search01Icon}
            className="size-4"
            strokeWidth={2}
          />
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

        <NotificationBell />
      </div>

      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </header>
  );
}
