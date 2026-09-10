import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { Building02Icon, PlusSignIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { ACTION_BUTTON_CLASS, Panel } from '@/components/instrument-panel'
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { DataTable } from '@/components/ui/data-table'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import {
  type CustomerGroupRow,
  customerGroupsColumns,
} from '@/features/customer-groups/components/columns'
import {
  useCreateCustomerGroupMutation,
  useCustomerGroupsList,
} from './queries'

export function CustomerGroupsPage() {
  const navigate = useNavigate()
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading, error } = useCustomerGroupsList(
    activeOrganizationId,
    !isContextSwitching,
  )
  const groups = data?.data ?? []

  const handleRowClick = (group: CustomerGroupRow) => {
    navigate({
      to: '/dashboard/clients/groups/$groupId/overview',
      params: { groupId: String(group.id) },
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
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
          <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
          Novo grupo
        </Button>
      </div>

      <Panel className="p-4 sm:p-5">
        {error ? (
          <div className="text-destructive py-8 text-center">
            Erro ao carregar grupos. Tente novamente.
          </div>
        ) : !isLoading && groups.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Building02Icon} />
              </EmptyMedia>
              <EmptyTitle>Nenhum grupo cadastrado</EmptyTitle>
              <EmptyDescription>
                Crie um grupo para reunir as unidades de uma rede de clientes e
                dar ao gestor uma visão consolidada no portal.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setCreateOpen(true)}>
                <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
                Novo grupo
              </Button>
            </EmptyContent>
          </Empty>
        ) : isLoading && !data ? (
          <DataTable
            columns={customerGroupsColumns}
            data={[]}
            isLoading={true}
          />
        ) : (
          <DataTable
            columns={customerGroupsColumns}
            data={groups}
            isLoading={isLoading}
            onRowClick={handleRowClick}
          />
        )}
      </Panel>

      <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function CreateGroupDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
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
        onSuccess: (group) => {
          toast.success('Grupo criado')
          setName('')
          setEmail('')
          onOpenChange(false)
          navigate({
            to: '/dashboard/clients/groups/$groupId/unidades',
            params: { groupId: String(group.id) },
          })
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
            O grupo recebe um acesso próprio ao portal. Informe o email do
            gestor para enviar o convite (opcional).
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
