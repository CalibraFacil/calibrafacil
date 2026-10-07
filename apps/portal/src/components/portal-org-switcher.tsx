import { useMemo } from "react";
import { Building02Icon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

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
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { shortcutLabel } from "@/lib/platform";
import { getWebAppUrl } from "@/lib/runtime-env";

export function PortalOrgSwitcher() {
  const { isMobile } = useSidebar();
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
    await portalOrganization.setActive({ organizationId: orgId });
    // Store preference for portal to avoid conflicts with dashboard
    localStorage.setItem("portal-active-org", orgId);
  };

  const handleGoToLab = (orgId: string) => {
    // Set the org as active, store preference for dashboard, and redirect
    portalOrganization.setActive({ organizationId: orgId }).then(() => {
      localStorage.setItem("dashboard-active-org", orgId);
      window.location.href = `${getWebAppUrl()}/dashboard`;
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
