import { useState } from 'react'
import type { ActivationStepId } from '@calibra-facil/client-runtime'
import { OnboardingStepHint } from '@/features/onboarding/step-hint'
import { toast } from 'sonner'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Add01Icon,
  Certificate01Icon,
  CheckmarkCircle02Icon,
  AlertCircleIcon,
  Clock01Icon,
  Delete02Icon,
  ViewIcon,
  StarIcon,
  Calendar03Icon,
  Building06Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { SigningCertificate } from '@calibra-facil/client-runtime'

import { useDashboardUnits } from '@/hooks/use-dashboard-units'
import { calibraApi } from '@/utils/api'
import { Panel, PanelHeader } from '@/components/instrument-panel'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
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
} from '@/components/ui/alert-dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useSigningCertificatesData } from '@/features/settings/queries'

type Certificate = SigningCertificate

export function CertificatesSettingsPage({
  onboardingStep,
}: {
  /** Set when the laboratory arrived here from the activation checklist. */
  onboardingStep?: ActivationStepId
} = {}) {
  const queryClient = useQueryClient()
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [selectedCert, setSelectedCert] = useState<Certificate | null>(null)
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false)
  const [certToRevoke, setCertToRevoke] = useState<Certificate | null>(null)

  const { isCheckingAccess, isConsolidated, selectedUnit } = useDashboardUnits()

  const { data, isLoading, error } = useSigningCertificatesData({
    unitId: typeof selectedUnit?.id === 'number' ? selectedUnit.id : null,
    enabled: Boolean(selectedUnit),
  })

  const certificates = data?.certificates ?? []

  const setDefaultMutation = useMutation({
    mutationFn: (id: number) => calibraApi.signingCertificates.setDefault(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['signing-certificates', selectedUnit?.id ?? 'no-unit'],
      })
      toast.success('Certificado definido como padrão')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const policyMutation = useMutation({
    mutationFn: (requireSignature: boolean) =>
      calibraApi.signingCertificates.setPolicy(requireSignature),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ['signing-certificates', selectedUnit?.id ?? 'no-unit'],
      })
      toast.success(
        result.requireSignature
          ? 'Assinatura digital agora é obrigatória nesta unidade'
          : 'Emissão sem assinatura permitida nesta unidade',
      )
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const revokeMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      calibraApi.signingCertificates.revoke(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['signing-certificates', selectedUnit?.id ?? 'no-unit'],
      })
      setRevokeDialogOpen(false)
      setCertToRevoke(null)
      toast.success('Certificado revogado')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  if (isCheckingAccess || (selectedUnit && isLoading)) {
    return <CertificatesSkeleton />
  }

  if (error) {
    return (
      <Panel className="p-6">
        <Empty>
          <EmptyMedia>
            <HugeiconsIcon
              icon={AlertCircleIcon}
              className="size-12 text-destructive"
            />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>Erro ao carregar certificados</EmptyTitle>
            <EmptyDescription>
              Não foi possível carregar os certificados. Tente novamente.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Panel>
    )
  }

  return (
    <div className="space-y-6">
      <OnboardingStepHint step={onboardingStep} expected="signingCertificate" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-balance text-lg font-semibold tracking-tight">
            Certificados ICP-Brasil
          </h2>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Cada unidade mantém sua carteira de certificados A1 (.p12/.pfx) e
            define o padrão usado para assinar os certificados de calibração.
          </p>
        </div>
        {selectedUnit && !isConsolidated ? (
          <Badge variant="secondary" className="shrink-0">
            {selectedUnit.name}
          </Badge>
        ) : null}
      </div>

      {isConsolidated ? (
        <Panel className="p-5 sm:p-6">
          <p className="text-sm text-muted-foreground">
            A visão consolidada está ativa. Selecione uma unidade específica no
            switcher para revisar, enviar ou trocar o certificado padrão.
          </p>
        </Panel>
      ) : !selectedUnit ? (
        <Panel className="p-5 sm:p-6">
          <p className="text-sm text-muted-foreground">
            Nenhuma unidade ativa encontrada para esta organização.
          </p>
        </Panel>
      ) : (
        <>
          {/* Política de assinatura (#644) */}
          <Panel className="p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium">Assinatura obrigatória</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Quando ativado, a emissão de certificados é bloqueada se não
                  houver certificado digital ativo configurado — o job falha com
                  o motivo registrado em vez de emitir sem assinatura. Falhas de
                  assinatura com certificado configurado sempre bloqueiam a
                  emissão.
                </p>
              </div>
              <Switch
                checked={data?.requireSignature ?? false}
                onCheckedChange={(checked) => policyMutation.mutate(checked)}
                disabled={policyMutation.isPending || isLoading}
                aria-label="Assinatura obrigatória"
              />
            </div>
          </Panel>

          {/* Certificates */}
          <Panel className="p-5 sm:p-6">
            <PanelHeader
              title="Carteira de certificados"
              description="Certificados digitais A1 (.p12/.pfx) para assinar os certificados de calibração."
              action={
                <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
                  <DialogTrigger render={<Button size="sm" />}>
                    <HugeiconsIcon icon={Add01Icon} className="mr-1.5 size-4" />
                    Adicionar certificado
                  </DialogTrigger>
                  <UploadCertificateDialog
                    onSuccess={() => {
                      setIsUploadOpen(false)
                      queryClient.invalidateQueries({
                        queryKey: ['signing-certificates', selectedUnit.id],
                      })
                    }}
                  />
                </Dialog>
              }
            />
            <div className="mt-4">
              {certificates.length === 0 ? (
                <Empty className="py-8">
                  <EmptyMedia>
                    <div className="size-16 rounded-2xl bg-muted flex items-center justify-center">
                      <HugeiconsIcon
                        icon={Certificate01Icon}
                        className="size-8 text-muted-foreground"
                      />
                    </div>
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>Nenhum certificado cadastrado</EmptyTitle>
                    <EmptyDescription>
                      Adicione um certificado ICP-Brasil A1 para assinar seus
                      certificados de calibração digitalmente nesta unidade.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="space-y-3">
                  {certificates.map((cert) => (
                    <CertificateCard
                      key={cert.id}
                      certificate={cert}
                      onView={() => setSelectedCert(cert)}
                      onSetDefault={() => setDefaultMutation.mutate(cert.id)}
                      onRevoke={() => {
                        setCertToRevoke(cert)
                        setRevokeDialogOpen(true)
                      }}
                      isSettingDefault={setDefaultMutation.isPending}
                    />
                  ))}
                </div>
              )}
            </div>
          </Panel>

          {/* Certificate detail dialog */}
          <Dialog
            open={!!selectedCert}
            onOpenChange={(open) => !open && setSelectedCert(null)}
          >
            {selectedCert && (
              <CertificateDetailDialog certificate={selectedCert} />
            )}
          </Dialog>

          {/* Revoke confirmation dialog */}
          <RevokeDialog
            certificate={certToRevoke}
            open={revokeDialogOpen}
            onOpenChange={setRevokeDialogOpen}
            onConfirm={(reason) => {
              if (certToRevoke) {
                revokeMutation.mutate({ id: certToRevoke.id, reason })
              }
            }}
            isLoading={revokeMutation.isPending}
          />
        </>
      )}
    </div>
  )
}

// Certificate card component
function CertificateCard({
  certificate,
  onView,
  onSetDefault,
  onRevoke,
  isSettingDefault,
}: {
  certificate: Certificate
  onView: () => void
  onSetDefault: () => void
  onRevoke: () => void
  isSettingDefault: boolean
}) {
  const statusConfig = {
    valid: {
      label: 'Válido',
      icon: CheckmarkCircle02Icon,
      className: 'bg-green-500/10 text-green-600 dark:text-green-400',
    },
    expired: {
      label: 'Expirado',
      icon: AlertCircleIcon,
      className: 'bg-red-500/10 text-red-600 dark:text-red-400',
    },
    not_yet_valid: {
      label: 'Ainda não válido',
      icon: Clock01Icon,
      className: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
    },
    revoked: {
      label: 'Revogado',
      icon: Delete02Icon,
      className: 'bg-muted text-muted-foreground',
    },
  }

  const status = statusConfig[certificate.status]
  const validUntil = new Date(certificate.validUntil)
  const daysUntilExpiry = Math.ceil(
    (validUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  )

  return (
    <div
      className={cn(
        'group relative rounded-xl border p-4 transition-all',
        'hover:border-primary/30 hover:shadow-sm',
        certificate.isDefault && 'border-primary/50 bg-primary/[0.02]',
        certificate.status === 'revoked' && 'opacity-60',
      )}
    >
      {/* Default badge */}
      {certificate.isDefault && (
        <div className="absolute -top-2 -right-2">
          <Badge
            variant="default"
            className="gap-1 bg-primary text-primary-foreground"
          >
            <HugeiconsIcon icon={StarIcon} className="size-3" />
            Padrão
          </Badge>
        </div>
      )}

      <div className="flex items-start gap-4">
        {/* Icon */}
        <div
          className={cn(
            'size-12 rounded-xl flex items-center justify-center shrink-0',
            certificate.status === 'valid' ? 'bg-primary/10' : 'bg-muted',
          )}
        >
          <HugeiconsIcon
            icon={Certificate01Icon}
            className={cn(
              'size-6',
              certificate.status === 'valid'
                ? 'text-primary'
                : 'text-muted-foreground',
            )}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-foreground truncate">
              {certificate.name}
            </h3>
            <Badge
              variant="outline"
              className={cn('shrink-0', status.className)}
            >
              <HugeiconsIcon icon={status.icon} className="size-3 mr-1" />
              {status.label}
            </Badge>
          </div>

          <p className="mt-1 text-sm text-muted-foreground truncate">
            {certificate.subjectCn}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <HugeiconsIcon icon={Building06Icon} className="size-3" />
              {certificate.issuerCn}
            </span>
            <span className="flex items-center gap-1">
              <HugeiconsIcon icon={Calendar03Icon} className="size-3" />
              Válido até {validUntil.toLocaleDateString('pt-BR')}
              {certificate.status === 'valid' && daysUntilExpiry <= 30 && (
                <span className="text-yellow-600 dark:text-yellow-400 font-medium">
                  ({daysUntilExpiry} dias)
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon-sm" onClick={onView}>
            <HugeiconsIcon icon={ViewIcon} className="size-4" />
          </Button>
          {certificate.status === 'valid' && !certificate.isDefault && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onSetDefault}
              disabled={isSettingDefault}
            >
              <HugeiconsIcon icon={StarIcon} className="size-4" />
            </Button>
          )}
          {certificate.status === 'valid' && (
            <Button variant="ghost" size="icon-sm" onClick={onRevoke}>
              <HugeiconsIcon
                icon={Delete02Icon}
                className="size-4 text-destructive"
              />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// Upload certificate dialog
function UploadCertificateDialog({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [setAsDefault, setSetAsDefault] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Selecione um arquivo')
      if (!name.trim()) throw new Error('Informe um nome para o certificado')
      if (!password) throw new Error('Informe a senha do certificado')

      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : ''
          // Remove data URL prefix
          const base64 = result.split(',')[1]
          resolve(base64)
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      return calibraApi.signingCertificates.upload({
        name: name.trim(),
        p12Base64: base64,
        password,
        setAsDefault,
      })
    },
    onSuccess: () => {
      toast.success('Certificado adicionado com sucesso!')
      onSuccess()
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Adicionar certificado ICP-Brasil</DialogTitle>
        <DialogDescription>
          Envie um certificado digital A1 (arquivo .p12 ou .pfx) para assinar
          seus certificados de calibração.
        </DialogDescription>
      </DialogHeader>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          uploadMutation.mutate()
        }}
        className="space-y-4"
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="cert-name">Nome do certificado</FieldLabel>
            <Input
              id="cert-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Certificado Principal"
              disabled={uploadMutation.isPending}
            />
            <FieldDescription>
              Um nome para identificar este certificado
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="cert-file">Arquivo do certificado</FieldLabel>
            <Input
              id="cert-file"
              type="file"
              accept=".p12,.pfx"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              disabled={uploadMutation.isPending}
              className="cursor-pointer"
            />
            <FieldDescription>Arquivo PKCS#12 (.p12 ou .pfx)</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="cert-password">
              Senha do certificado
            </FieldLabel>
            <Input
              id="cert-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Digite a senha"
              disabled={uploadMutation.isPending}
            />
          </Field>

          <Field orientation="horizontal">
            <div className="flex items-center gap-2">
              <Checkbox
                id="set-default"
                checked={setAsDefault}
                onCheckedChange={(checked) => setSetAsDefault(checked === true)}
                disabled={uploadMutation.isPending}
              />
              <FieldLabel htmlFor="set-default" className="cursor-pointer">
                Definir como certificado padrão
              </FieldLabel>
            </div>
          </Field>

          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" disabled={uploadMutation.isPending} />
            }
          >
            Cancelar
          </DialogClose>
          <Button type="submit" disabled={uploadMutation.isPending}>
            {uploadMutation.isPending ? 'Enviando...' : 'Adicionar'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

// Certificate detail dialog
function CertificateDetailDialog({
  certificate,
}: {
  certificate: Certificate
}) {
  const details = [
    { label: 'Nome', value: certificate.name },
    { label: 'Titular', value: certificate.subjectCn },
    {
      label: 'CPF/CNPJ',
      value: certificate.subjectCpfCnpj || 'Não informado',
    },
    { label: 'Emissor', value: certificate.issuerCn },
    { label: 'Número de série', value: certificate.serialNumber },
    {
      label: 'Válido desde',
      value: new Date(certificate.validFrom).toLocaleDateString('pt-BR'),
    },
    {
      label: 'Válido até',
      value: new Date(certificate.validUntil).toLocaleDateString('pt-BR'),
    },
    {
      label: 'Adicionado em',
      value: new Date(certificate.createdAt).toLocaleDateString('pt-BR'),
    },
    { label: 'Adicionado por', value: certificate.createdByName || '-' },
  ]

  if (certificate.revokedAt) {
    details.push(
      {
        label: 'Revogado em',
        value: new Date(certificate.revokedAt).toLocaleDateString('pt-BR'),
      },
      { label: 'Motivo da revogação', value: certificate.revokedReason || '-' },
    )
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Detalhes do certificado</DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        {details.map((item, idx) => (
          <div
            key={idx}
            className="flex justify-between items-start py-2 border-b border-border/50 last:border-0"
          >
            <span className="text-sm text-muted-foreground">{item.label}</span>
            <span className="text-sm font-medium text-right max-w-[60%] break-all">
              {item.value}
            </span>
          </div>
        ))}
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Fechar</DialogClose>
      </DialogFooter>
    </DialogContent>
  )
}

// Revoke confirmation dialog
function RevokeDialog({
  certificate,
  open,
  onOpenChange,
  onConfirm,
  isLoading,
}: {
  certificate: Certificate | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reason: string) => void
  isLoading: boolean
}) {
  const [reason, setReason] = useState('')

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revogar certificado</AlertDialogTitle>
          <AlertDialogDescription>
            Tem certeza que deseja revogar o certificado{' '}
            <strong>{certificate?.name}</strong>? Esta ação não pode ser
            desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-2">
          <Field>
            <FieldLabel htmlFor="revoke-reason">Motivo da revogação</FieldLabel>
            <Textarea
              id="revoke-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Certificado expirado, comprometido, etc."
              rows={3}
            />
          </Field>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onConfirm(reason)}
            disabled={!reason.trim() || isLoading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading ? 'Revogando...' : 'Revogar certificado'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CertificatesSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <Panel className="space-y-3 p-5 sm:p-6">
        {[1, 2].map((i) => (
          <div key={i} className="rounded-xl border p-4">
            <div className="flex items-start gap-4">
              <Skeleton className="size-12 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  )
}
