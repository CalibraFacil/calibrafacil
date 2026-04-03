import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useActiveOrganization } from '@calibra-facil/auth/client'
import {
  Add01Icon,
  Certificate01Icon,
  CheckmarkCircle02Icon,
  AlertCircleIcon,
  Clock01Icon,
  Delete02Icon,
  ViewIcon,
  StarIcon,
  ShieldKeyIcon,
  Calendar03Icon,
  Building06Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { api } from '@/utils/api'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/dashboard/settings/certificates')({
  head: () => ({
    meta: [{ title: 'Certificados ICP-Brasil | Configurações | CalibraFácil' }],
  }),
  component: CertificatesSettingsPage,
})

interface Certificate {
  id: number
  unitId: number
  name: string
  serialNumber: string
  issuerCn: string
  subjectCn: string
  subjectCpfCnpj: string | null
  validFrom: string
  validUntil: string
  isActive: boolean
  isDefault: boolean
  createdAt: string
  createdByName: string | null
  revokedAt: string | null
  revokedReason: string | null
  status: 'valid' | 'expired' | 'not_yet_valid' | 'revoked'
}

interface UnitContextResponse {
  activeUnitId: number | null
  activeUnitName: string | null
  selectedUnitScope: 'all' | 'unit'
  data: Array<{
    id: number
    name: string
    slug: string
    role: string
  }>
}

function CertificatesSettingsPage() {
  const { data: activeOrg } = useActiveOrganization()
  const queryClient = useQueryClient()
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [selectedCert, setSelectedCert] = useState<Certificate | null>(null)
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false)
  const [certToRevoke, setCertToRevoke] = useState<Certificate | null>(null)

  const unitContextQuery = useQuery({
    queryKey: ['dashboard-units', activeOrg?.id ?? 'no-org'],
    enabled: Boolean(activeOrg?.id),
    queryFn: async () => {
      const response = await api.api.units.$get()
      if (!response.ok) {
        throw new Error('Falha ao carregar contexto de unidades')
      }

      return (await response.json()) as UnitContextResponse
    },
  })

  const selectedUnit =
    unitContextQuery.data?.selectedUnitScope === 'unit'
      ? (unitContextQuery.data.data ?? []).find(
          (unit) => unit.id === unitContextQuery.data?.activeUnitId,
        ) ?? null
      : null
  const isConsolidated = unitContextQuery.data?.selectedUnitScope === 'all'

  // Fetch certificates
  const { data, isLoading, error } = useQuery({
    queryKey: ['signing-certificates', selectedUnit?.id ?? 'no-unit'],
    enabled: Boolean(selectedUnit),
    queryFn: async () => {
      const res = await api.api.signing.certificates.$get()
      if (!res.ok) throw new Error('Failed to fetch certificates')
      return res.json()
    },
  })

  const certificates = (data as { certificates: Certificate[] })?.certificates ?? []

  // Set default mutation
  const setDefaultMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.api.signing.certificates[':id']['set-default'].$post({
        param: { id: String(id) },
      })
      if (!res.ok) throw new Error('Failed to set default')
      return res.json()
    },
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

  // Revoke mutation
  const revokeMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const res = await api.api.signing.certificates[':id'].$delete({
        param: { id: String(id) },
        json: { reason },
      })
      if (!res.ok) throw new Error('Failed to revoke')
      return res.json()
    },
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

  if (unitContextQuery.isLoading || (selectedUnit && isLoading)) {
    return <CertificatesSkeleton />
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12">
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
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Escopo dos Certificados de Assinatura</CardTitle>
          <CardDescription>
            Cada unidade mantém sua própria carteira de certificados ICP-Brasil
            e define o padrão usado nas emissões daquela unidade.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isConsolidated ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              A visão consolidada está ativa. Selecione uma unidade específica no
              switcher para revisar, enviar ou trocar o certificado padrão
              daquela unidade.
            </div>
          ) : selectedUnit ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{selectedUnit.name}</Badge>
              <Badge variant="outline">Pool de assinatura ativo</Badge>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Nenhuma unidade ativa encontrada para esta organização.
            </div>
          )}
        </CardContent>
      </Card>

      {!selectedUnit ? null : (
        <>
      {/* Header card */}
      <Card>
        <CardHeader>
          <CardTitle>Certificados ICP-Brasil</CardTitle>
          <CardDescription>
            Gerencie os certificados digitais A1 para assinatura de
            certificados de calibração conforme NIT-DICLA-083.
          </CardDescription>
          <CardAction>
            <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
              <DialogTrigger render={<Button size="sm" />}>
                <HugeiconsIcon icon={Add01Icon} className="size-4 mr-1.5" />
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
          </CardAction>
        </CardHeader>

        <CardContent>
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
        </CardContent>
      </Card>

      {/* Info card */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Sobre assinatura digital</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-2">
            <div className="flex items-start gap-3">
              <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <HugeiconsIcon
                  icon={ShieldKeyIcon}
                  className="size-4 text-primary"
                />
              </div>
              <div>
                <p className="font-medium text-foreground">Conformidade RBC</p>
                <p className="mt-0.5 text-xs">
                  Atende NIT-DICLA-083 para certificados eletrônicos
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <HugeiconsIcon
                  icon={Certificate01Icon}
                  className="size-4 text-primary"
                />
              </div>
              <div>
                <p className="font-medium text-foreground">Certificado A1</p>
                <p className="mt-0.5 text-xs">
                  Arquivo PKCS#12 (.p12 ou .pfx) com validade de 1 ano
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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
    (validUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  )

  return (
    <div
      className={cn(
        'group relative rounded-xl border p-4 transition-all',
        'hover:border-primary/30 hover:shadow-sm',
        certificate.isDefault && 'border-primary/50 bg-primary/[0.02]',
        certificate.status === 'revoked' && 'opacity-60'
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
            certificate.status === 'valid'
              ? 'bg-primary/10'
              : 'bg-muted'
          )}
        >
          <HugeiconsIcon
            icon={Certificate01Icon}
            className={cn(
              'size-6',
              certificate.status === 'valid'
                ? 'text-primary'
                : 'text-muted-foreground'
            )}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-foreground truncate">
              {certificate.name}
            </h3>
            <Badge variant="outline" className={cn('shrink-0', status.className)}>
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
              <HugeiconsIcon icon={Delete02Icon} className="size-4 text-destructive" />
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
          const result = reader.result as string
          // Remove data URL prefix
          const base64 = result.split(',')[1]
          resolve(base64)
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const res = await api.api.signing.certificates.$post({
        json: {
          name: name.trim(),
          p12Base64: base64,
          password,
          setAsDefault,
        },
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error((data as { error?: string }).error || 'Upload failed')
      }
      return res.json()
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
                onCheckedChange={(checked) =>
                  setSetAsDefault(checked === true)
                }
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
            render={<Button variant="outline" disabled={uploadMutation.isPending} />}
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
      { label: 'Motivo da revogação', value: certificate.revokedReason || '-' }
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
            <FieldLabel htmlFor="revoke-reason">
              Motivo da revogação
            </FieldLabel>
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
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-4 w-80" />
        <CardAction>
          <Skeleton className="h-9 w-40" />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
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
      </CardContent>
    </Card>
  )
}
