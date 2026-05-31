import * as React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import {
  Building02Icon,
  MapsIcon,
  Settings05Icon,
  UnfoldMoreIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import {
  organization,
  useActiveOrganization,
  useListOrganizations,
} from '@calibra-facil/auth/client'

import { useDashboardUnits } from '@/hooks/use-dashboard-units'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import {
  setStoredDashboardActiveUnitIdForOrganization,
  setStoredDashboardOrganizationId,
} from '@/features/dashboard/dashboard-scope-storage'

export function OrganizationSwitcher() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isMobile } = useSidebar()
  const { data: allOrganizations, isPending: isLoadingOrgs } =
    useListOrganizations()
  const { data: activeOrg } = useActiveOrganization()
  const {
    currentUnitLabel,
    currentUnitValue,
    data: unitsData,
    hasMultiUnit,
  } = useDashboardUnits()

  const organizations = React.useMemo(() => {
    if (!allOrganizations) return []
    return allOrganizations.filter((org) => org.type !== 'CLIENT')
  }, [allOrganizations])

  const handleSetActiveOrganization = async (orgId: string) => {
    await organization.setActive({ organizationId: orgId })
    setStoredDashboardOrganizationId(orgId)
    await queryClient.invalidateQueries()
  }

  const handleSetActiveUnit = async (value: string) => {
    if (!activeOrg?.id) return

    setStoredDashboardActiveUnitIdForOrganization(activeOrg.id, value)

    await queryClient.invalidateQueries()
  }

  if (isLoadingOrgs) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg">
            <Skeleton className="size-8 rounded-lg" />
            <div className="grid flex-1 gap-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-20" />
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
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
                    {activeOrg?.name ?? 'Selecionar laboratório'}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {currentUnitLabel}
                  </span>
                </div>
                <HugeiconsIcon icon={UnfoldMoreIcon} className="ml-auto" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-64 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground text-xs">
                Laboratórios
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={activeOrg?.id ?? ''}
                onValueChange={handleSetActiveOrganization}
              >
                {organizations.length > 0 ? (
                  organizations.map((org) => (
                    <DropdownMenuRadioItem key={org.id} value={org.id}>
                      <HugeiconsIcon icon={Building02Icon} className="size-4" />
                      <div className="min-w-0">
                        <div className="truncate">{org.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {org.slug}
                        </div>
                      </div>
                    </DropdownMenuRadioItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled>
                    Nenhum laboratório encontrado
                  </DropdownMenuItem>
                )}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>

            {activeOrg?.id && hasMultiUnit && unitsData ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-muted-foreground text-xs">
                    Matrizes e unidades
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={currentUnitValue}
                    onValueChange={handleSetActiveUnit}
                  >
                    {unitsData.canAccessAllUnits ? (
                      <DropdownMenuRadioItem value="all">
                        <HugeiconsIcon icon={MapsIcon} className="size-4" />
                        <div className="min-w-0">
                          <div className="truncate">Todas as unidades</div>
                          <div className="truncate text-xs text-muted-foreground">
                            Visão consolidada da organização
                          </div>
                        </div>
                      </DropdownMenuRadioItem>
                    ) : null}

                    {unitsData.data.map((unit) => (
                      <DropdownMenuRadioItem
                        key={unit.id}
                        value={String(unit.id)}
                      >
                        <HugeiconsIcon icon={MapsIcon} className="size-4" />
                        <div className="min-w-0">
                          <div className="truncate">{unit.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {unit.role === 'unit_admin'
                              ? 'Administrador da unidade'
                              : unit.role === 'technician'
                                ? 'Técnico da unidade'
                                : 'Escopo operacional'}
                          </div>
                        </div>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </>
            ) : null}

            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                navigate({ to: '/dashboard/settings/organization' })
              }
            >
              <HugeiconsIcon icon={Settings05Icon} className="size-4" />
              Gerenciar organização e unidades
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
