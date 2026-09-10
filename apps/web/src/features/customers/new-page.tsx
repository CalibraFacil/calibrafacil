import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { getPortalBaseUrl } from '@/app/config/runtime'
import {
  CustomerCreateForm,
  type CreatedCustomer,
  getCustomerInvitationId,
} from '@/features/customers/components/customer-create-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function NewClientPage() {
  const navigate = useNavigate()

  const [showInviteDialog, setShowInviteDialog] = useState(false)
  const [invitationId, setInvitationId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const getInviteUrl = () => {
    if (!invitationId) return ''
    return `${getPortalBaseUrl()}/accept-invite?token=${invitationId}`
  }

  const handleCopyLink = async () => {
    const url = getInviteUrl()
    await navigator.clipboard.writeText(url)
    setCopied(true)
    toast.success('Link copiado!')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCloseDialog = () => {
    setShowInviteDialog(false)
    navigate({ to: '/dashboard/clients' })
  }

  const handleSaved = (customer: CreatedCustomer) => {
    const newInvitationId = getCustomerInvitationId(customer)
    if (newInvitationId) {
      setInvitationId(newInvitationId)
      setShowInviteDialog(true)
    } else {
      toast.success('Cliente criado com sucesso!')
      navigate({ to: '/dashboard/clients' })
    }
  }

  return (
    <div className="space-y-6">
      <div className="min-w-0 space-y-1">
        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          Novo cliente
        </h1>
        <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
          Cadastre os dados do cliente. Quando um email é informado, o convite
          para o portal é enviado automaticamente.
        </p>
      </div>

      <CustomerCreateForm
        onSaved={handleSaved}
        onCancel={() => navigate({ to: '/dashboard/clients' })}
      />

      {/* Invitation Link Dialog */}
      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Cliente criado com sucesso</DialogTitle>
            <DialogDescription>
              Um link de convite foi gerado para o cliente acessar o portal.
              Copie e envie para o cliente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Field>
              <FieldLabel htmlFor="invite-link">Link de convite</FieldLabel>
              <div className="flex min-w-0 gap-2">
                <Input
                  id="invite-link"
                  name="inviteLink"
                  value={getInviteUrl()}
                  readOnly
                  className="font-mono text-xs"
                  aria-describedby="invite-link-description"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopyLink}
                  aria-label="Copiar link de convite"
                >
                  <HugeiconsIcon
                    icon={copied ? Tick02Icon : Copy01Icon}
                    className="size-4"
                    aria-hidden="true"
                  />
                </Button>
              </div>
              <FieldDescription id="invite-link-description" aria-live="polite">
                {copied
                  ? 'Link copiado.'
                  : 'Este link permite que o cliente crie uma conta e acesse o portal.'}
              </FieldDescription>
            </Field>
          </div>

          <DialogFooter>
            <Button onClick={handleCloseDialog}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
