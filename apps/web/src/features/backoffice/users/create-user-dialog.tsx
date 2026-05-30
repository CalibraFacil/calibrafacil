import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toNewPlatformUserRole, type NewPlatformUserDraft } from './model'
import type { UserMutations } from './mutations'

const EMPTY_DRAFT: NewPlatformUserDraft = {
  name: '',
  email: '',
  role: 'platform_operator',
}

/**
 * Invite-only creation of an internal (platform) user. Lives behind a header
 * button instead of an always-open card, so the page leads with the user list.
 */
export function CreateUserDialog({
  createUser,
}: {
  createUser: UserMutations['createUser']
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<NewPlatformUserDraft>(EMPTY_DRAFT)

  const canSubmit = Boolean(draft.name.trim() && draft.email.trim())

  const submit = () => {
    if (!canSubmit) return
    createUser.mutate(draft, {
      onSuccess: () => {
        setDraft(EMPTY_DRAFT)
        setOpen(false)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            className="min-h-9 transition-transform active:scale-[0.96]"
          />
        }
      >
        <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
        Novo usuário interno
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar usuário interno</DialogTitle>
          <DialogDescription>
            O backoffice é invite-only. Após criar a conta, o sistema envia um
            email para definição de senha.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <Field>
            <FieldLabel htmlFor="newUserName">Nome</FieldLabel>
            <Input
              id="newUserName"
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="newUserEmail">Email</FieldLabel>
            <Input
              id="newUserEmail"
              type="email"
              value={draft.email}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  email: event.target.value,
                }))
              }
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="newUserRole">Papel</FieldLabel>
            <NativeSelect
              id="newUserRole"
              value={draft.role}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  role: toNewPlatformUserRole(event.target.value),
                }))
              }
            >
              <NativeSelectOption value="platform_operator">
                Operador
              </NativeSelectOption>
              <NativeSelectOption value="platform_admin">
                Admin
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              type="submit"
              disabled={!canSubmit || createUser.isPending}
              className="transition-transform active:scale-[0.96]"
            >
              {createUser.isPending ? 'Criando…' : 'Criar usuário'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
