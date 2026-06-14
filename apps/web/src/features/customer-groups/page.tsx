import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  ArrowRight01Icon,
  Building03Icon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
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
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import {
  useCreateCustomerGroupMutation,
  useCustomerGroupsList,
} from './queries'

export function CustomerGroupsPage() {
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const [createOpen, setCreateOpen] = useState(false)

  const groupsQuery = useCustomerGroupsList(
    activeOrganizationId,
    !isContextSwitching,
  )
  const groups = groupsQuery.data?.data ?? []

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
          <HugeiconsIcon
            icon={Add01Icon}
            strokeWidth={2}
            className="mr-2 size-4"
          />
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
        <Panel className="p-2">
          <ul className="divide-y divide-border/70">
            {groups.map((group) => (
              <li key={group.id}>
                <Link
                  to="/dashboard/clients/groups/$groupId/overview"
                  params={{ groupId: String(group.id) }}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted/60"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground ring-1 ring-foreground/10"
                    >
                      <HugeiconsIcon icon={Building03Icon} className="size-4" />
                    </span>
                    <span className="min-w-0 truncate text-sm font-medium">
                      {group.name}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge
                      variant="secondary"
                      className="font-mono tabular-nums"
                    >
                      {group.branchCount}{' '}
                      {group.branchCount === 1 ? 'unidade' : 'unidades'}
                    </Badge>
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

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
