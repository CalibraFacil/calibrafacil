import {
  type FormEvent,
  Fragment,
  type ReactNode,
  useRef,
  useState,
} from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Copy01Icon,
  Delete02Icon,
  Key01Icon,
  LinkSquare02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type {
  ContaAzulAppSaveResponse,
  ContaAzulAppSummary,
} from '@/features/settings/types'
import {
  CONTA_AZUL_DEVELOPER_PORTAL_URL,
  contaAzulAppSavedMessage,
  type ContaAzulAppDraft,
  type ContaAzulAppDraftErrors,
  emptyContaAzulAppDraft,
  parseContaAzulAppDraft,
} from './conta-azul-app-form'

// A self-hosted server has no shared Conta Azul application: the laboratory
// creates its own on Conta Azul's developer portal (minutes, no review) and
// pastes the two credentials here. Connecting then works as usual.

/** Shown instead of the Connect button until the laboratory has an application. */
export function ContaAzulAppSetup({
  app,
  onChanged,
}: {
  app: ContaAzulAppSummary
  onChanged: () => Promise<void>
}) {
  return (
    <section aria-labelledby="conta-azul-app-setup-title" className="space-y-4">
      <div className="space-y-1">
        <h3
          id="conta-azul-app-setup-title"
          className="text-sm font-semibold text-balance"
        >
          Antes de conectar, cadastre o aplicativo do laboratório
        </h3>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          O Conta Azul só autoriza aplicativos registrados no Portal do
          Desenvolvedor. O do laboratório leva uns 10 minutos para criar e fica
          pronto na hora, sem aprovação.
        </p>
      </div>

      <ol className="space-y-5">
        <SetupStep
          number={1}
          title="Entre no Portal do Desenvolvedor do Conta Azul"
          description="Crie uma conta se ainda não tiver uma."
        >
          <a
            href={CONTA_AZUL_DEVELOPER_PORTAL_URL}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <HugeiconsIcon icon={LinkSquare02Icon} />
            Abrir o portal
          </a>
        </SetupStep>
        <SetupStep
          number={2}
          title="Crie um aplicativo de Produção"
          description="Dê um nome que identifique o laboratório, informe o CNPJ e, em URL de redirecionamento, cole exatamente este endereço:"
        >
          <CopyField label="URL de redirecionamento" value={app.redirectUri} />
        </SetupStep>
        <SetupStep
          number={3}
          title="Cole aqui o Client ID e o Client Secret"
          description="O portal mostra os dois assim que o aplicativo é criado. O CalibraFácil confere o par com o Conta Azul antes de salvar."
        >
          <ContaAzulAppForm onSaved={onChanged} />
        </SetupStep>
      </ol>
    </section>
  )
}

/** Which application connects, under the Connect button. */
export function ContaAzulAppStatus({
  app,
  onChanged,
}: {
  app: ContaAzulAppSummary
  onChanged: () => Promise<void>
}) {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
      <HugeiconsIcon icon={Key01Icon} className="size-3.5" />
      {app.source === 'organization' ? (
        <span>
          Aplicativo do laboratório ·{' '}
          <span className="font-mono text-foreground">{app.clientId}</span>
          {app.clientSecretLast4 ? (
            <>
              {' '}
              · Secret terminado em{' '}
              <span className="font-mono text-foreground">
                {app.clientSecretLast4}
              </span>
            </>
          ) : null}
        </span>
      ) : (
        <span>Aplicativo fornecido por este servidor</span>
      )}
      <Button
        variant="link"
        size="xs"
        className="h-auto px-0"
        onClick={() => setDialogOpen(true)}
      >
        {app.source === 'organization'
          ? 'Trocar'
          : 'Usar um aplicativo próprio'}
      </Button>
      <ContaAzulAppDialog
        app={app}
        connected={false}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onChanged={onChanged}
      />
    </div>
  )
}

/** Review or replace the application; also reachable once connected. */
export function ContaAzulAppDialog({
  app,
  connected,
  open,
  onOpenChange,
  onChanged,
}: {
  app: ContaAzulAppSummary | undefined
  connected: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<void>
}) {
  const afterChange = async () => {
    onOpenChange(false)
    await onChanged()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Aplicativo Conta Azul</DialogTitle>
          <DialogDescription className="text-pretty">
            {app?.source === 'organization'
              ? `O laboratório conecta pelo aplicativo ${app.clientId ?? ''}.`
              : app?.source === 'server'
                ? 'O laboratório conecta pelo aplicativo deste servidor. Cadastre um próprio para usá-lo no lugar.'
                : 'Cadastre o aplicativo que o laboratório criou no Portal do Desenvolvedor do Conta Azul.'}
            {connected
              ? ' Um novo Client Secret do mesmo aplicativo mantém a conexão; outro Client ID exige conectar de novo.'
              : null}
          </DialogDescription>
        </DialogHeader>

        {app ? (
          <div className="space-y-5">
            <Field>
              <FieldLabel>URL de redirecionamento</FieldLabel>
              <CopyField
                label="URL de redirecionamento"
                value={app.redirectUri}
              />
              <FieldDescription>
                Deve ser exatamente a cadastrada no aplicativo, no Portal do
                Desenvolvedor.
              </FieldDescription>
            </Field>
            <ContaAzulAppForm onSaved={afterChange} />
            {app.source === 'organization' ? (
              <RemoveContaAzulApp
                connected={connected}
                onRemoved={afterChange}
              />
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function SetupStep({
  number,
  title,
  description,
  children,
}: {
  number: number
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
      <span
        aria-hidden
        className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums ring-1 ring-inset ring-border"
      >
        {number}
      </span>
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="col-start-2">{children}</div>
    </li>
  )
}

function CopyField({ label, value }: { label: string; value: string }) {
  const valueRef = useRef<HTMLElement>(null)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    // Without a secure context there is no clipboard API: leave the address
    // selected for Ctrl+C instead.
    if (!navigator.clipboard) {
      if (valueRef.current) {
        window.getSelection()?.selectAllChildren(valueRef.current)
      }
      toast.info('Endereço selecionado. Copie com Ctrl+C.')
      return
    }
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  // The whole address stays visible (it wraps): it must be registered
  // character for character.
  return (
    <div className="flex max-w-2xl items-start gap-2 rounded-md border bg-muted/40 py-1.5 pr-1.5 pl-3">
      <code
        ref={valueRef}
        aria-label={label}
        className="min-w-0 flex-1 py-1 font-mono text-xs leading-relaxed break-words"
      >
        {withSlashBreaks(value)}
      </code>
      <Button
        variant="ghost"
        size="xs"
        aria-label={`Copiar ${label.toLowerCase()}`}
        onClick={copy}
      >
        <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} />
        {copied ? 'Copiada' : 'Copiar'}
      </Button>
    </div>
  )
}

/**
 * A break opportunity after each slash, so a long address wraps at a path
 * boundary instead of mid-word. <wbr> adds no characters: selecting and
 * copying the text still yields the exact address.
 */
function withSlashBreaks(value: string) {
  const nodes: ReactNode[] = []
  let start = 0
  for (const part of value.split('/')) {
    const end = start + part.length
    nodes.push(
      <Fragment key={start}>
        {part}
        {end < value.length ? (
          <>
            /<wbr />
          </>
        ) : null}
      </Fragment>,
    )
    start = end + 1
  }
  return nodes
}

function ContaAzulAppForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<ContaAzulAppDraft>(emptyContaAzulAppDraft)
  const [errors, setErrors] = useState<ContaAzulAppDraftErrors>({})

  const save = useMutation({
    mutationFn: (credentials: { clientId: string; clientSecret: string }) =>
      calibraApi.integrations.saveContaAzulApp<ContaAzulAppSaveResponse>(
        credentials,
      ),
    onSuccess: async (result) => {
      toast.success(contaAzulAppSavedMessage(result.check))
      setDraft(emptyContaAzulAppDraft)
      await onSaved()
    },
  })

  const setField = (field: keyof ContaAzulAppDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsed = parseContaAzulAppDraft(draft)
    if (!parsed.ok) {
      setErrors(parsed.errors)
      return
    }
    setErrors({})
    save.mutate(parsed.value)
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid max-w-xl gap-4 sm:grid-cols-2"
    >
      <Field data-invalid={Boolean(errors.clientId)}>
        <FieldLabel htmlFor="conta-azul-client-id">Client ID</FieldLabel>
        <Input
          id="conta-azul-client-id"
          value={draft.clientId}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(errors.clientId)}
          onChange={(event) => setField('clientId', event.target.value)}
        />
        <FieldError>{errors.clientId}</FieldError>
      </Field>
      <Field data-invalid={Boolean(errors.clientSecret)}>
        <FieldLabel htmlFor="conta-azul-client-secret">
          Client Secret
        </FieldLabel>
        <Input
          id="conta-azul-client-secret"
          type="password"
          value={draft.clientSecret}
          autoComplete="new-password"
          spellCheck={false}
          aria-invalid={Boolean(errors.clientSecret)}
          onChange={(event) => setField('clientSecret', event.target.value)}
        />
        <FieldError>{errors.clientSecret}</FieldError>
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Verificando…' : 'Salvar e verificar'}
        </Button>
        <span className="text-xs text-muted-foreground">
          O Client Secret fica criptografado e não é exibido de novo.
        </span>
      </div>
      {save.isError ? (
        <p
          role="alert"
          className="text-sm text-pretty text-destructive sm:col-span-2"
        >
          {save.error instanceof Error
            ? save.error.message
            : 'Falha ao salvar o aplicativo Conta Azul.'}
        </p>
      ) : null}
    </form>
  )
}

function RemoveContaAzulApp({
  connected,
  onRemoved,
}: {
  connected: boolean
  onRemoved: () => Promise<void>
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const remove = useMutation({
    mutationFn: () =>
      calibraApi.integrations.removeContaAzulApp<ContaAzulAppSummary>(),
    onSuccess: async () => {
      toast.success('Aplicativo Conta Azul removido.')
      setConfirmOpen(false)
      await onRemoved()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao remover o aplicativo Conta Azul.',
      )
    },
  })

  return (
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setConfirmOpen(true)}
      >
        <HugeiconsIcon icon={Delete02Icon} />
        Remover aplicativo
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover o aplicativo Conta Azul?</AlertDialogTitle>
          <AlertDialogDescription className="text-pretty">
            {connected
              ? 'A conta conectada deixa de sincronizar até o laboratório cadastrar um aplicativo e conectar de novo.'
              : 'Para conectar depois, será preciso cadastrar um aplicativo de novo.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remover
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
