import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { Rocket01Icon } from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { BlueprintOverlay } from '@/components/instrument-panel'
import { ACTION_BUTTON_CLASS } from '@/features/backoffice/console'

type ProvisionResult = {
  organization: { id: string; name: string; slug: string }
  passwordSetupRequested: boolean
  passwordSetupMessage: string
}

const EMPTY = {
  labName: '',
  labSlug: '',
  labCnpj: '',
  labEmail: '',
  labPhone: '',
  ownerName: '',
  ownerEmail: '',
  planId: 'FREE',
}

export function ProvisionDrawer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(EMPTY)

  const update = (patch: Partial<typeof EMPTY>) =>
    setForm((prev) => ({ ...prev, ...patch }))

  const provisionLab = useMutation({
    mutationFn: () =>
      calibraApi.backoffice.provisionLab<ProvisionResult>({
        lab: {
          name: form.labName,
          slug: form.labSlug,
          cnpj: form.labCnpj,
          email: form.labEmail,
          phone: form.labPhone,
          planId: form.planId,
        },
        owner: { name: form.ownerName, email: form.ownerEmail },
        onboarding: { sendSetupEmail: true },
      }),
    onSuccess: async (result) => {
      toast.success(
        result.passwordSetupRequested
          ? 'Laboratório provisionado e link de setup enviado.'
          : result.passwordSetupMessage,
      )
      setForm(EMPTY)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['backoffice', 'organizations'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['backoffice', 'customer-success', 'organizations'],
        }),
      ])
      onClose()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao provisionar laboratório',
      )
    },
  })

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        <div className="relative overflow-hidden border-b px-5 py-4">
          <BlueprintOverlay />
          <SheetHeader className="relative gap-1 p-0 pr-8">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Onboarding
            </p>
            <SheetTitle className="flex items-center gap-2 text-lg font-semibold">
              <HugeiconsIcon icon={Rocket01Icon} className="size-5" />
              Provisionar laboratório
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              Cria a organização, vincula o proprietário e envia o link de
              definição de senha.
            </SheetDescription>
          </SheetHeader>
        </div>

        <form
          id="provision-lab-form"
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault()
            provisionLab.mutate()
          }}
        >
          <Field>
            <FieldLabel htmlFor="lab-name">Laboratório</FieldLabel>
            <Input
              id="lab-name"
              value={form.labName}
              onChange={(event) => update({ labName: event.target.value })}
              placeholder="Laboratório Exemplo"
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="lab-slug">Slug</FieldLabel>
              <Input
                id="lab-slug"
                value={form.labSlug}
                onChange={(event) => update({ labSlug: event.target.value })}
                placeholder="laboratorio-exemplo"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="lab-cnpj">CNPJ</FieldLabel>
              <Input
                id="lab-cnpj"
                value={form.labCnpj}
                onChange={(event) => update({ labCnpj: event.target.value })}
                placeholder="00.000.000/0001-00"
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="owner-name">Proprietário</FieldLabel>
              <Input
                id="owner-name"
                value={form.ownerName}
                onChange={(event) => update({ ownerName: event.target.value })}
                placeholder="Nome do responsável"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="owner-email">Email do proprietário</FieldLabel>
              <Input
                id="owner-email"
                type="email"
                value={form.ownerEmail}
                onChange={(event) => update({ ownerEmail: event.target.value })}
                placeholder="responsavel@laboratorio.com"
                required
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="lab-email">Email LAB</FieldLabel>
              <Input
                id="lab-email"
                type="email"
                value={form.labEmail}
                onChange={(event) => update({ labEmail: event.target.value })}
                placeholder="contato@laboratorio.com"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="lab-phone">Telefone</FieldLabel>
              <Input
                id="lab-phone"
                value={form.labPhone}
                onChange={(event) => update({ labPhone: event.target.value })}
                placeholder="(11) 99999-9999"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="lab-plan">Plano</FieldLabel>
              <NativeSelect
                id="lab-plan"
                className="w-full"
                value={form.planId}
                onChange={(event) => update({ planId: event.target.value })}
              >
                <NativeSelectOption value="FREE">Free</NativeSelectOption>
                <NativeSelectOption value="STANDARD">Standard</NativeSelectOption>
                <NativeSelectOption value="PROFESSIONAL">
                  Professional
                </NativeSelectOption>
                <NativeSelectOption value="ENTERPRISE">
                  Enterprise
                </NativeSelectOption>
              </NativeSelect>
            </Field>
          </div>
        </form>

        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="provision-lab-form"
            disabled={provisionLab.isPending}
            className={ACTION_BUTTON_CLASS}
          >
            {provisionLab.isPending
              ? 'Provisionando…'
              : 'Provisionar laboratório'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
