import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building02Icon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { PORTAL_ORG_KEY } from "@calibra-facil/shared/client-storage-keys";
import { labHandoffUrl } from "@calibra-facil/shared/lab-handoff";
import {
  portalOrganization,
  usePortalActiveOrganization,
  usePortalListOrganizations,
} from "@calibra-facil/auth/client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@calibra-facil/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@calibra-facil/ui/sidebar";
import { Skeleton } from "@calibra-facil/ui/skeleton";
import { shortcutLabel } from "@/lib/platform";
import {
  cancelPortalQueries,
  removePortalQueries,
} from "@/lib/portal-query-keys";
import { getWebAppUrl } from "@/lib/runtime-env";

export function PortalOrgSwitcher() {
  const { isMobile } = useSidebar();
  const queryClient = useQueryClient();
  const { data: allOrganizations, isPending: isLoadingOrgs } =
    usePortalListOrganizations();
  const { data: activeOrg } = usePortalActiveOrganization();

  // Separate organizations by type
  const { clientOrgs, labOrgs } = useMemo(() => {
    if (!allOrganizations) return { clientOrgs: [], labOrgs: [] };

    return {
      clientOrgs: allOrganizations.filter((org) => org.type === "CLIENT"),
      labOrgs: allOrganizations.filter((org) => org.type !== "CLIENT"),
    };
  }, [allOrganizations]);

  const handleSetActiveOrganization = async (orgId: string) => {
    // Stop requests still in flight for the organization being left, so their
    // answers cannot land in the cache once the session points elsewhere.
    await cancelPortalQueries(queryClient);
    const result = await portalOrganization.setActive({
      organizationId: orgId,
    });
    if (result?.error) {
      // The session still names the old organization: keep its cache and its
      // stored preference, or the screen would say one org while the API
      // answers for another.
      toast.error("Não foi possível trocar de organização.");
      return;
    }
    // The API answers for the organization the session names, not the one in a
    // key, so what guarantees isolation is this switch: nothing fetched for the
    // previous organization survives it. The keys carry the org id as well, so
    // the new org's entries (its queries may already be in flight) are kept.
    removePortalQueries(queryClient, orgId);
    // Store preference for portal to avoid conflicts with dashboard
    localStorage.setItem(PORTAL_ORG_KEY, orgId);
  };

  const handleGoToLab = (orgId: string) => {
    // The lab keeps its active organization in its own origin's storage, out
    // of the portal's reach: the choice goes in the URL and the lab stores it.
    portalOrganization.setActive({ organizationId: orgId }).then(() => {
      window.location.href = labHandoffUrl(getWebAppUrl(), orgId);
    });
  };

  if (isLoadingOrgs) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg">
            <Skeleton className="size-8 rounded-lg" />
            <div className="grid flex-1 gap-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <HugeiconsIcon icon={Building02Icon} className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {activeOrg?.name ?? "Selecionar organização"}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {activeOrg?.type === "CLIENT"
                      ? "Portal do cliente"
                      : (activeOrg?.slug ?? "Nenhuma selecionada")}
                  </span>
                </div>
                <HugeiconsIcon icon={UnfoldMoreIcon} className="ml-auto" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            {/* Client Organizations Section */}
            {clientOrgs.length > 0 && (
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  Portal do Cliente
                </DropdownMenuLabel>
                {clientOrgs.map((org, index) => (
                  <DropdownMenuItem
                    key={org.id}
                    onClick={() => handleSetActiveOrganization(org.id)}
                    className="gap-2 p-2"
                  >
                    <div className="flex size-6 items-center justify-center rounded-md border">
                      <HugeiconsIcon
                        icon={Building02Icon}
                        className="size-3.5 shrink-0"
                      />
                    </div>
                    {org.name}
                    {index < 9 && (
                      <DropdownMenuShortcut>
                        {shortcutLabel(String(index + 1))}
                      </DropdownMenuShortcut>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            )}

            {/* Separator between sections */}
            {clientOrgs.length > 0 && labOrgs.length > 0 && (
              <DropdownMenuSeparator />
            )}

            {/* Lab Organizations Section */}
            {labOrgs.length > 0 && (
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  Laboratório
                </DropdownMenuLabel>
                {labOrgs.map((org) => (
                  <DropdownMenuItem
                    key={org.id}
                    onClick={() => handleGoToLab(org.id)}
                    className="gap-2 p-2"
                  >
                    <div className="flex size-6 items-center justify-center rounded-md border bg-primary/10">
                      <HugeiconsIcon
                        icon={Building02Icon}
                        className="size-3.5 shrink-0 text-primary"
                      />
                    </div>
                    <span>{org.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      →
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            )}

            {/* Empty state */}
            {clientOrgs.length === 0 && labOrgs.length === 0 && (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                Nenhuma organização encontrada
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
