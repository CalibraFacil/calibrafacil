import { Building06Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { useActiveOrganization } from '@calibra-facil/auth/client'
import { usePlanAccess } from '@/hooks/use-plan-access'
import {
  useOrganizationGovernanceMembersData,
  useOrganizationUnitsData,
} from '@/features/settings/queries'
import {
  canManageOrganizationSettings as canManageOrganizationSettingsForRole,
  getCurrentOrganizationRole,
} from '@/features/settings/organization-model'
import type { ActiveOrganization } from '@/features/settings/organization/shared'
import { OrganizationProfileSection } from '@/features/settings/organization/profile-section'
import { OrganizationUnitsSection } from '@/features/settings/organization/units-section'
import { OrganizationMembersSection } from '@/features/settings/organization/members-section'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

export type OrganizationSection = 'profile' | 'units' | 'members'

export function OrganizationSettingsRoute({
  section = 'profile',
}: {
  section?: OrganizationSection
} = {}) {
  const { data: activeOrg, isPending: isLoadingOrg } = useActiveOrganization()

  if (isLoadingOrg) {
    return <OrganizationSkeleton />
  }

  if (!activeOrg) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={Building06Icon} />
          </EmptyMedia>
          <EmptyTitle>Nenhuma organização selecionada</EmptyTitle>
          <EmptyDescription>
            Selecione ou crie uma organização para gerenciar suas configurações.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <OrganizationSettingsPage
      key={activeOrg.id}
      activeOrg={activeOrg}
      section={section}
    />
  )
}

/**
 * Thin composition over the per-section modules in ./organization — the page
 * derives the shared permission flags (governance viewer, plan entitlements)
 * and hands each route section to the component that owns its state.
 */
function OrganizationSettingsPage({
  activeOrg,
  section,
}: {
  activeOrg: ActiveOrganization
  section: OrganizationSection
}) {
  const currentOrgRole = getCurrentOrganizationRole(activeOrg)
  const canManageOrganizationSettings =
    canManageOrganizationSettingsForRole(currentOrgRole)

  const accessQuery = usePlanAccess()
  const hasMultiUnit =
    accessQuery.data?.entitlements.includes('multi_unit') ?? false

  const unitsQuery = useOrganizationUnitsData({
    organizationId: activeOrg.id,
    enabled: hasMultiUnit,
  })
  const governanceMembersQuery = useOrganizationGovernanceMembersData({
    organizationId: activeOrg.id,
    enabled: hasMultiUnit,
  })

  const governanceViewer =
    governanceMembersQuery.data?.viewer ?? unitsQuery.data?.viewer ?? null
  const canManageOrganizationUnits =
    governanceViewer?.canManageOrganizationUnits ??
    canManageOrganizationSettings
  const canManageAssignments = governanceViewer?.canManageAssignments ?? false
  const canManageGlobalRoles =
    governanceViewer?.canManageGlobalRoles ?? canManageOrganizationSettings
  const canViewGovernance = governanceViewer?.canViewGovernance ?? false

  const sectionDescription =
    section === 'units'
      ? 'Unidades operacionais e governança por unidade.'
      : section === 'members'
        ? 'Membros da organização e convites pendentes.'
        : 'Identidade do laboratório: postura multiunidade, detalhes, logotipo e informações ISO 17025.'

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
        {sectionDescription}
      </p>

      {section === 'profile' && (
        <OrganizationProfileSection
          activeOrg={activeOrg}
          canManageOrganizationSettings={canManageOrganizationSettings}
          hasMultiUnit={hasMultiUnit}
          governanceViewer={governanceViewer}
        />
      )}

      {section === 'units' && (
        <OrganizationUnitsSection
          activeOrg={activeOrg}
          hasMultiUnit={hasMultiUnit}
          canManageOrganizationUnits={canManageOrganizationUnits}
          canManageAssignments={canManageAssignments}
          canViewGovernance={canViewGovernance}
          units={unitsQuery.data?.data ?? []}
          unitsLoading={unitsQuery.isPending}
          governanceMembers={governanceMembersQuery.data?.data ?? []}
          governanceMembersLoading={governanceMembersQuery.isPending}
        />
      )}

      {section === 'members' && (
        <OrganizationMembersSection
          activeOrg={activeOrg}
          canManageOrganizationSettings={canManageOrganizationSettings}
          canManageGlobalRoles={canManageGlobalRoles}
        />
      )}
    </div>
  )
}

function OrganizationSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <div className="flex justify-end">
            <Skeleton className="h-9 w-32" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
