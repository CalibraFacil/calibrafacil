import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { Building03Icon, Delete02Icon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { ACTION_BUTTON_CLASS } from '@/components/instrument-panel'
import {
  ClientPanel,
  ClientPanelBody,
  ClientSection,
} from '@/features/customers/components/client-detail-ui'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import { useCustomersListData } from '@/features/customers/queries'
import {
  useAssignBranchMutation,
  useCustomerGroupDetailData,
  useRemoveBranchMutation,
} from '@/features/customer-groups/queries'

export function CustomerGroupUnidadesTab({ groupId }: { groupId: number }) {
  const { activeOrganizationId } = useDashboardContextState()
  const detailQuery = useCustomerGroupDetailData(groupId)
  const assignMutation = useAssignBranchMutation(groupId)
  const removeMutation = useRemoveBranchMutation(groupId)
  const [branchToAdd, setBranchToAdd] = useState('')

  const customersQuery = useCustomersListData({
    activeOrganizationId,
    enabled: true,
    page: 1,
    limit: 100,
    search: '',
  })

  const group = detailQuery.data
  const branchIds = useMemo(
    () => new Set((group?.branches ?? []).map((branch) => branch.id)),
    [group],
  )
  // Candidate branches = the lab's customers not already in this group.
  const candidates = (customersQuery.data?.data ?? []).filter(
    (customer) => !branchIds.has(customer.id),
  )

  function assign() {
    const id = Number(branchToAdd)
    if (!Number.isInteger(id) || id <= 0) return
    assignMutation.mutate(id, {
      onSuccess: () => {
        setBranchToAdd('')
        toast.success('Unidade vinculada ao grupo')
      },
      onError: (error) => toast.error(error.message),
    })
  }

  function remove(customerId: number) {
    removeMutation.mutate(customerId, {
      onSuccess: () => toast.success('Unidade desvinculada'),
      onError: (error) => toast.error(error.message),
    })
  }

  const selectedCandidate = candidates.find(
    (candidate) => String(candidate.id) === branchToAdd,
  )

  return (
    <ClientPanel
      eyebrow="Unidades"
      title="Unidades do grupo"
      description="Clientes deste laboratório que compõem a rede. O gestor do grupo vê todas as unidades de forma consolidada no portal."
    >
      <ClientPanelBody className="space-y-6">
        <ClientSection
          icon={<HugeiconsIcon icon={Building03Icon} className="size-4" />}
          title="Vincular unidade"
          description="Apenas clientes deste laboratório podem ser vinculados."
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field className="flex-1">
              <FieldLabel htmlFor="branch">Cliente</FieldLabel>
              <Select
                value={branchToAdd}
                onValueChange={(value) => setBranchToAdd(value ?? '')}
              >
                <SelectTrigger id="branch">
                  <span
                    className={selectedCandidate ? '' : 'text-muted-foreground'}
                  >
                    {selectedCandidate?.name ?? 'Selecione um cliente...'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((candidate) => (
                    <SelectItem key={candidate.id} value={String(candidate.id)}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Um cliente só pode pertencer a um grupo por vez.
              </FieldDescription>
            </Field>
            <Button
              onClick={assign}
              disabled={!branchToAdd || assignMutation.isPending}
              className={ACTION_BUTTON_CLASS}
            >
              {assignMutation.isPending ? <Spinner className="mr-2" /> : null}
              Vincular
            </Button>
          </div>
        </ClientSection>

        <ClientSection
          icon={<HugeiconsIcon icon={Building03Icon} className="size-4" />}
          title="Unidades vinculadas"
          description="Remover uma unidade não a exclui — apenas a desvincula do grupo."
        >
          {detailQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="size-7" />
            </div>
          ) : !group || group.branches.length === 0 ? (
            <Empty className="rounded-none border-x-0 border-y border-solid border-border/70 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Building03Icon} />
                </EmptyMedia>
                <EmptyTitle>Nenhuma unidade neste grupo</EmptyTitle>
                <EmptyDescription>
                  Vincule clientes acima para montar a rede.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="space-y-1">
              {group.branches.map((branch) => (
                <div
                  key={branch.id}
                  className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{branch.name}</p>
                    {branch.taxId ? (
                      <p className="font-mono text-xs tabular-nums text-muted-foreground">
                        {branch.taxId}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Desvincular ${branch.name}`}
                    onClick={() => remove(branch.id)}
                    disabled={removeMutation.isPending}
                  >
                    <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ClientSection>
      </ClientPanelBody>
    </ClientPanel>
  )
}
