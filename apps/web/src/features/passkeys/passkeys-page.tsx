import { useState } from 'react'
import { toast } from 'sonner'
import { FingerPrintIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

import {
  useAddPasskey,
  useDeletePasskey,
  useRenamePasskey,
  useUserPasskeys,
} from './queries'
import { defaultPasskeyName, parsePasskeyNameForm } from './forms'
import { passkeyProviderLabel } from './provider-labels'
import { isWebAuthnSupported } from './webauthn'
import { type UserPasskey } from './types'

const CREATED_AT_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
})

function formatCreatedAt(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return CREATED_AT_FORMAT.format(date)
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function PasskeysSettingsPage() {
  const webAuthnSupported = isWebAuthnSupported()
  const passkeysQuery = useUserPasskeys()
  const addPasskey = useAddPasskey()
  const renamePasskey = useRenamePasskey()
  const deletePasskey = useDeletePasskey()

  const [renameTarget, setRenameTarget] = useState<UserPasskey | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)

  const passkeys = passkeysQuery.data ?? []

  async function handleAdd() {
    try {
      await addPasskey.mutateAsync(defaultPasskeyName(new Date()))
      toast.success('Passkey criada com sucesso.')
    } catch (error) {
      toast.error(messageOf(error, 'Não foi possível criar a passkey.'))
    }
  }

  function openRename(passkey: UserPasskey) {
    setRenameTarget(passkey)
    setRenameValue(passkey.name ?? '')
    setRenameError(null)
  }

  async function handleRenameSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!renameTarget) return

    const parsed = parsePasskeyNameForm({ name: renameValue })
    if (!parsed.success) {
      setRenameError(parsed.message)
      return
    }

    try {
      await renamePasskey.mutateAsync({
        id: renameTarget.id,
        name: parsed.data.name,
      })
      toast.success('Passkey renomeada.')
      setRenameTarget(null)
    } catch (error) {
      setRenameError(messageOf(error, 'Não foi possível renomear a passkey.'))
    }
  }

  async function handleDelete(id: string) {
    try {
      await deletePasskey.mutateAsync(id)
      toast.success('Passkey removida.')
    } catch (error) {
      toast.error(messageOf(error, 'Não foi possível remover a passkey.'))
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Passkeys</CardTitle>
            <CardDescription>
              Entre sem senha usando Face ID, Touch ID, Windows Hello ou seu
              gerenciador de senhas. Suas passkeys ficam no seu dispositivo ou
              no seu gerenciador — nunca em nossos servidores.
            </CardDescription>
          </div>
          <Button
            type="button"
            onClick={handleAdd}
            disabled={!webAuthnSupported || addPasskey.isPending}
          >
            {addPasskey.isPending ? (
              <>
                <Spinner className="mr-2" />
                Criando...
              </>
            ) : (
              'Adicionar passkey'
            )}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!webAuthnSupported ? (
            <Alert>
              <AlertTitle>Passkeys indisponíveis neste navegador</AlertTitle>
              <AlertDescription>
                Abra o CalibraFácil em um navegador atualizado e em uma conexão
                segura (HTTPS) para criar e usar passkeys.
              </AlertDescription>
            </Alert>
          ) : null}

          {passkeysQuery.isPending ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          ) : passkeysQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Falha ao carregar suas passkeys</AlertTitle>
              <AlertDescription>
                {messageOf(
                  passkeysQuery.error,
                  'Tente novamente em instantes.',
                )}
              </AlertDescription>
            </Alert>
          ) : passkeys.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={FingerPrintIcon} />
                </EmptyMedia>
                <EmptyTitle>Nenhuma passkey ainda</EmptyTitle>
                <EmptyDescription>
                  Crie uma passkey para entrar mais rápido e com mais segurança,
                  sem precisar de senha ou código por email.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  type="button"
                  onClick={handleAdd}
                  disabled={!webAuthnSupported || addPasskey.isPending}
                >
                  {addPasskey.isPending ? (
                    <>
                      <Spinner className="mr-2" />
                      Criando...
                    </>
                  ) : (
                    'Criar passkey'
                  )}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {passkeys.map((passkey) => {
                const provider = passkeyProviderLabel(passkey.aaguid)
                const displayName = passkey.name?.trim() || provider
                const createdAt = formatCreatedAt(passkey.createdAt)
                return (
                  <li
                    key={passkey.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                        <HugeiconsIcon
                          icon={FingerPrintIcon}
                          className="size-5"
                        />
                      </span>
                      <div className="space-y-1">
                        <p className="text-sm font-medium leading-none">
                          {displayName}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="secondary">{provider}</Badge>
                          <Badge variant="outline">
                            {passkey.backedUp
                              ? 'Sincronizada'
                              : 'Neste dispositivo'}
                          </Badge>
                          {createdAt ? (
                            <span>Adicionada em {createdAt}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openRename(passkey)}
                      >
                        Renomear
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                            >
                              Remover
                            </Button>
                          }
                        />
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Remover esta passkey?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Você não poderá mais entrar com “{displayName}”.
                              Garanta que ainda tem outra forma de acesso antes
                              de remover.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => handleDelete(passkey.id)}
                              disabled={deletePasskey.isPending}
                            >
                              Remover
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
      >
        <DialogContent>
          <form onSubmit={handleRenameSubmit}>
            <DialogHeader>
              <DialogTitle>Renomear passkey</DialogTitle>
              <DialogDescription>
                Dê um nome que ajude a reconhecer este dispositivo ou
                gerenciador.
              </DialogDescription>
            </DialogHeader>
            <Field className="my-4">
              <FieldLabel htmlFor="passkey-name">Nome</FieldLabel>
              <Input
                id="passkey-name"
                value={renameValue}
                onChange={(event) => {
                  setRenameValue(event.target.value)
                  setRenameError(null)
                }}
                autoFocus
              />
              {renameError ? <FieldError>{renameError}</FieldError> : null}
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameTarget(null)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={renamePasskey.isPending}>
                {renamePasskey.isPending ? (
                  <>
                    <Spinner className="mr-2" />
                    Salvando...
                  </>
                ) : (
                  'Salvar'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
