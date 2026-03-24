import { Link, useMatches } from "@tanstack/react-router";
import { Fragment, useMemo } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

const routeLabels: Record<string, string> = {
  "/_authenticated": "Painel",
  "/_authenticated/assets": "Ativos",
  "/_authenticated/certificates": "Certificados",
  "/_authenticated/requests": "Solicitações",
  "/_authenticated/requests/new": "Nova Solicitação",
  "/_authenticated/requests/$id": "Solicitação",
  "/_authenticated/settings": "Configurações",
  "/_authenticated/settings/appearance": "Aparência",
};

export function PortalHeader() {
  const matches = useMatches();

  const breadcrumbs = useMemo(() => {
    const seenRouteIds = new Set<string>();

    return matches
      .filter((m) => m.routeId?.startsWith("/_authenticated"))
      .map((m) => {
        const normalizedRouteId = m.routeId.replace(/\/+$/, "");
        const normalizedPath = m.pathname.replace(/\/+$/, "") || "/";

        return {
          routeId: normalizedRouteId,
          path: normalizedPath,
          label:
            routeLabels[normalizedRouteId] ??
            normalizedPath.split("/").pop() ??
            "",
        };
      })
      .filter((match) => {
        if (seenRouteIds.has(match.routeId)) {
          return false;
        }

        seenRouteIds.add(match.routeId);
        return true;
      });
  }, [matches]);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-8" />
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
    </header>
  );
}
