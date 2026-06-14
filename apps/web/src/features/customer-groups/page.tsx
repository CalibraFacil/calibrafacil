import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  Building03Icon,
  Delete02Icon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
} from '@/components/instrument-panel'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { useDashboardContextState } from '@/contexts/dashboard-context'
import { useCustomersListData } from '@/features/customers/queries'
import { cn } from '@/lib/utils'
import {
  useAssignBranchMutation,
  useCreateCustomerGroupMutation,
  useCustomerGroupDetail,
  useCustomerGroupsList,
  useRemoveBranchMutation,
} from './queries'

export function CustomerGroupsPage() {
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const groupsQuery = useCustomerGroupsList(
    activeOrganizationId,
    !isContextSwitching,
  )
  const groups = groupsQuery.data?.data ?? []

  // Default the selection to the first group once loaded (render-time, no effect).
  const effectiveGroupId =
    selectedGroupId ?? (groups.length > 0 ? groups[0].id : null)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Cadastro
          </p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            Grupos de clientes
          </h1>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Organize redes de clientes multiunidade. O gestor do grupo vê todas
            as unidades de forma consolidada no portal.
          </p>
        </div>
        <Button
          className={`${ACTION_BUTTON_CLASS} shrink-0`}
          onClick={() => setCreateOpen(true)}
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="mr-2 size-4" />
          Novo grupo
        </Button>
      </div>

      {groupsQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-7" />
        </div>
      ) : groups.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Building03Icon} />
            </EmptyMedia>
            <EmptyTitle>Nenhum grupo cadastrado</EmptyTitle>
            <EmptyDescription>
              Crie um grupo para reunir as unidades de uma rede de clientes e dar
              ao gestor uma visão consolidada no portal.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[20rem_1fr] lg:items-start">
          <Panel className="p-3">
            <div className="space-y-1">
              {groups.map((group) => {
                const active = group.id === effectiveGroupId
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setSelectedGroupId(group.id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors',
                      active ? 'bg-muted' : 'hover:bg-muted/60',
                    )}
                  >
                    <span className="min-w-0 truncate text-sm font-medium">
                      {group.name}
                    </span>
                    <Badge variant="secondary" className="font-mono tabular-nums">
                      {group.branchCount}
                    </Badge>
                  </button>
                )
              })}
            </div>
          </Panel>

          {effectiveGroupId !== null ? (
            <GroupDetail
              key={effectiveGroupId}
              groupId={effectiveGroupId}
              activeOrganizationId={activeOrganizationId}
            />
          ) : null}
        </div>
      )}

      <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function GroupDetail({
  groupId,
  activeOrganizationId,
}: {
  groupId: number
  activeOrganizationId: string | null
}) {
  const detailQuery = useCustomerGroupDetail(activeOrganizationId, groupId)
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

  if (detailQuery.isLoading || !group) {
    return (
      <Panel className="flex justify-center p-16">
        <Spinner className="size-7" />
      </Panel>
    )
  }

  const selectedCandidate = candidates.find(
    (candidate) => String(candidate.id) === branchToAdd,
  )

  return (
    <Panel className="space-y-5 p-5">
      <PanelHeader
        eyebrow="Grupo"
        title={group.name}
        description="Unidades (clientes) que compõem este grupo."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field className="flex-1">
          <FieldLabel htmlFor="branch">Adicionar unidade</FieldLabel>
          <Select
            value={branchToAdd}
            onValueChange={(value) => setBranchToAdd(value ?? '')}
          >
            <SelectTrigger id="branch">
              <span className={selectedCandidate ? '' : 'text-muted-foreground'}>
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
            Apenas clientes deste laboratório podem ser vinculados.
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

      <div className="space-y-1">
        {group.branches.length === 0 ? (
          <p className="text-muted-foreground rounded-lg bg-muted/40 p-4 text-sm">
            Nenhuma unidade neste grupo ainda.
          </p>
        ) : (
          group.branches.map((branch) => (
            <div
              key={branch.id}
              className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-muted/50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{branch.name}</p>
                {branch.taxId ? (
                  <p className="text-muted-foreground font-mono text-xs tabular-nums">
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
          ))
        )}
      </div>
    </Panel>
  )
}

function CreateGroupDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const createMutation = useCreateCustomerGroupMutation()

  function submit() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Informe o nome do grupo.')
      return
    }
    createMutation.mutate(
      { name: trimmed, email: email.trim() || undefined },
      {
        onSuccess: () => {
          toast.success('Grupo criado')
          setName('')
          setEmail('')
          onOpenChange(false)
        },
        onError: (error) => toast.error(error.message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo grupo de clientes</DialogTitle>
          <DialogDescription>
            O grupo recebe um acesso próprio ao portal. Informe o email do gestor
            para enviar o convite (opcional).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Field>
            <FieldLabel htmlFor="group-name">Nome do grupo</FieldLabel>
            <Input
              id="group-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Rede Concreto Modelo"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="group-email">
              Email do gestor (opcional)
            </FieldLabel>
            <Input
              id="group-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="gestor@rede.com.br"
            />
            <FieldDescription>
              Recebe um convite para acessar o portal consolidado do grupo.
            </FieldDescription>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={createMutation.isPending}>
            {createMutation.isPending ? <Spinner className="mr-2" /> : null}
            Criar grupo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
