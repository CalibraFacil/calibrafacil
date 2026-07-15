import { describe, expect, it } from 'vitest'

import type {
  GovernanceActivityEntry,
  GovernanceMember,
  OrganizationMember,
  OrganizationUnit,
} from '@/features/settings/types'
import {
  buildOrganizationIdentityPayload,
  buildOrganizationIsoPayload,
  buildDraftAssignmentsForMember,
  canManageOrganizationSettings,
  createAssignmentDrafts,
  createOrganizationIdentityDraft,
  createOrganizationIsoDraft,
  createUnitNameDrafts,
  formatInvitationTimeRemaining,
  getCurrentOrganizationRole,
  getGovernanceActivityDescription,
  getGovernanceActivityLabel,
  getInvitationStatusLabel,
  getInvitationStatusVariant,
  getInviterName,
  getOrganizationRoleLabel,
  getPersistedAssignmentsForMember,
  getUnitAssignmentRoleLabel,
  hasAssignmentChanges,
  isEditableUnitAssignmentRole,
  isGlobalMemberRole,
  mergeUnitNameDrafts,
  organizationAssignmentQueryKeys,
  organizationInvitationsQueryKey,
  organizationMembersQueryKey,
  organizationRoleGovernanceQueryKeys,
  organizationUnitGovernanceQueryKeys,
  updateAssignmentDraftOverride,
} from './organization-model'

const units: OrganizationUnit[] = [
  {
    id: 2,
    name: 'Laboratório Sul',
    slug: 'lab-sul',
    status: 'ACTIVE',
    isDefault: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
  },
  {
    id: 1,
    name: 'Matriz',
    slug: 'matriz',
    status: 'ACTIVE',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
  },
]

function createGovernanceMember(): GovernanceMember {
  return {
    id: 'member-1',
    userId: 'user-1',
    role: 'technician',
    name: 'Ana',
    email: 'ana@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    assignments: [
      {
        unitId: 2,
        unitName: 'Laboratório Sul',
        role: 'technician',
      },
    ],
  }
}

function createActivity(
  overrides: Partial<GovernanceActivityEntry>,
): GovernanceActivityEntry {
  return {
    id: 1,
    action: 'unit.created',
    entityType: 'organization_unit',
    entityId: '1',
    createdAt: '2026-01-01T00:00:00.000Z',
    details: null,
    unit: null,
    actorUser: null,
    ...overrides,
  }
}

describe('organization-model', () => {
  it('maps global and unit roles to user-facing labels', () => {
    expect(isGlobalMemberRole('admin')).toBe(true)
    expect(isGlobalMemberRole('owner')).toBe(false)
    expect(isEditableUnitAssignmentRole('unit_admin')).toBe(true)
    expect(isEditableUnitAssignmentRole('owner')).toBe(false)
    expect(getOrganizationRoleLabel('owner')).toBe('Proprietário')
    expect(getOrganizationRoleLabel('client_user')).toBe('Cliente')
    expect(getUnitAssignmentRoleLabel('unit_admin')).toBe('Admin. da unidade')
  })

  it('describes governance activity records', () => {
    expect(
      getGovernanceActivityLabel(
        createActivity({ action: 'unit.assignments.updated' }),
      ),
    ).toBe('Atribuições por unidade atualizadas')
    expect(
      getGovernanceActivityDescription(
        createActivity({
          action: 'unit.assignments.updated',
          details: {
            after: [{ unitId: 1, role: 'member' }],
            scopedUnitIds: [1, 2],
          },
        }),
      ),
    ).toBe('1 atribuição(ões) ativas em 2 unidade(s).')
    expect(
      getGovernanceActivityDescription(
        createActivity({
          action: 'member.role.updated',
          details: { after: { role: 'admin' } },
        }),
      ),
    ).toBe('Papel global definido como Administrador.')
    expect(
      getGovernanceActivityDescription(
        createActivity({ unit: { id: 1, name: 'Matriz' } }),
      ),
    ).toBe('Escopo afetado: Matriz.')
  })

  it('creates and normalizes assignment drafts', () => {
    const member = createGovernanceMember()
    const baseDrafts = createAssignmentDrafts([member], units)
    const draft = buildDraftAssignmentsForMember({
      memberId: member.id,
      units,
      baseDrafts,
      overrides: {
        [member.id]: {
          1: 'unit_admin',
          2: 'none',
          99: 'member',
        },
      },
    })

    expect(baseDrafts[member.id]).toEqual({ 1: 'none', 2: 'technician' })
    expect(draft).toEqual([{ unitId: 1, role: 'unit_admin' }])
    expect(getPersistedAssignmentsForMember(member)).toEqual([
      { unitId: 2, role: 'technician' },
    ])
    expect(hasAssignmentChanges(member, draft)).toBe(true)
    expect(
      hasAssignmentChanges(member, getPersistedAssignmentsForMember(member)),
    ).toBe(false)
    expect(
      updateAssignmentDraftOverride({
        current: {},
        memberId: member.id,
        unitId: 1,
        role: 'member',
      }),
    ).toEqual({ [member.id]: { 1: 'member' } })
  })

  it('builds organization profile and ISO drafts and payloads', () => {
    expect(getCurrentOrganizationRole({ members: [{ role: 'admin' }] })).toBe(
      'admin',
    )
    expect(getCurrentOrganizationRole({ members: [] })).toBe('member')
    expect(canManageOrganizationSettings('owner')).toBe(true)
    expect(canManageOrganizationSettings('member')).toBe(false)

    expect(
      createOrganizationIdentityDraft({
        name: 'Lab',
        slug: null,
      }),
    ).toEqual({ name: 'Lab', slug: '' })
    expect(
      buildOrganizationIdentityPayload({
        name: ' Lab  ',
        slug: '  ',
      }),
    ).toEqual({ name: 'Lab', slug: undefined })

    const isoDraft = createOrganizationIsoDraft({
      cnpj: '123',
      accreditationNumber: null,
      city: 'Curitiba',
      technicalManagerName: 'Ana',
    })
    expect(isoDraft).toMatchObject({
      cnpj: '123',
      accreditationNumber: '',
      city: 'Curitiba',
      technicalManagerName: 'Ana',
    })
    expect(
      buildOrganizationIsoPayload({
        ...isoDraft,
        cnpj: ' 123 ',
        city: ' ',
      }),
    ).toMatchObject({
      cnpj: '123',
      city: undefined,
      technicalManagerName: 'Ana',
    })

    // #647: vigência travels as an ISO string (Better Auth rejects Date-typed
    // fields on JSON bodies), start-of-day / end-of-day anchored. Empty stays
    // "" so the server clears the stored date (undefined would be skipped by
    // the partial update).
    expect(
      buildOrganizationIsoPayload({
        ...isoDraft,
        accreditationValidFrom: '2027-03-01',
        accreditationValidUntil: '2027-03-05',
      }),
    ).toMatchObject({
      accreditationValidFrom: '2027-03-01T00:00:00.000Z',
      accreditationValidUntil: '2027-03-05T23:59:59.999Z',
    })
    expect(buildOrganizationIsoPayload(isoDraft)).toMatchObject({
      accreditationValidFrom: '',
      accreditationValidUntil: '',
    })
  })

  it('builds unit name drafts from units and local overrides', () => {
    const baseDrafts = createUnitNameDrafts(units)
    expect(baseDrafts).toEqual({ 1: 'Matriz', 2: 'Laboratório Sul' })
    expect(mergeUnitNameDrafts(baseDrafts, { 2: 'Sul atualizado' })).toEqual({
      1: 'Matriz',
      2: 'Sul atualizado',
    })
  })

  it('centralizes organization settings query invalidation keys', () => {
    expect(organizationUnitGovernanceQueryKeys('org-1')).toEqual([
      ['organization-units', 'org-1'],
      ['organization-governance-members', 'org-1'],
      ['organization-governance-activity', 'org-1'],
      ['dashboard-units', 'org-1'],
    ])
    expect(organizationAssignmentQueryKeys('org-1')).toEqual([
      ['organization-governance-members', 'org-1'],
      ['organization-governance-activity', 'org-1'],
      ['dashboard-units', 'org-1'],
    ])
    expect(organizationRoleGovernanceQueryKeys('org-1')).toEqual([
      ['organization-members', 'org-1'],
      ['organization-governance-members', 'org-1'],
      ['organization-governance-activity', 'org-1'],
    ])
    expect(organizationInvitationsQueryKey('org-1')).toEqual([
      'organization-invitations',
      'org-1',
    ])
    expect(organizationMembersQueryKey('org-1')).toEqual([
      'organization-members',
      'org-1',
    ])
  })

  it('formats invitation state and inviter names', () => {
    const now = new Date('2026-01-01T12:00:00.000Z')
    expect(
      formatInvitationTimeRemaining(new Date('2026-01-03T12:00:00Z'), now),
    ).toBe('2 dias')
    expect(
      formatInvitationTimeRemaining(new Date('2026-01-01T15:00:00Z'), now),
    ).toBe('3 horas')
    expect(
      formatInvitationTimeRemaining(new Date('2026-01-01T12:20:00Z'), now),
    ).toBe('20 minutos')
    expect(
      formatInvitationTimeRemaining(new Date('2026-01-01T11:00:00Z'), now),
    ).toBe('expirado')
    expect(getInvitationStatusLabel('accepted')).toBe('Aceito')
    expect(getInvitationStatusVariant('rejected')).toBe('destructive')

    const members: OrganizationMember[] = [
      {
        id: 'member-1',
        userId: 'user-1',
        role: 'admin',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        user: {
          id: 'user-1',
          name: 'Ana',
          email: 'ana@example.com',
        },
      },
    ]
    expect(getInviterName(members, 'user-1')).toBe('Ana')
    expect(getInviterName(members, 'missing')).toBeUndefined()
  })
})
