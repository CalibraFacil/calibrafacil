import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
    ArrowLeft01Icon,
    Calendar03Icon,
    Edit02Icon,
    CheckmarkCircle02Icon,
    Cancel01Icon,
    MultiplicationSignIcon,
    UserAdd01Icon,
} from '@hugeicons/core-free-icons'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card'
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
import { Field, FieldLabel } from '@/components/ui/field'
import { getFinancialStatusLabel } from '@calibra-facil/shared'
import { ApprovedJobRecord } from './-components/approved-job-record'

export const Route = createFileRoute('/dashboard/jobs/$id/')({
    head: () => ({
        meta: [{ title: 'Detalhes do Job | CalibraFácil' }],
    }),
    component: JobDetailPage,
})

type JobStatus =
    | 'DRAFT'
    | 'IN_PROGRESS'
    | 'REVIEW'
    | 'GENERATING_PDF'
    | 'APPROVED'
    | 'REJECTED'
    | 'CANCELED'
    | 'SUPERSEDED'

const statusLabels: Record<JobStatus, string> = {
    DRAFT: 'Rascunho',
    IN_PROGRESS: 'Em Execução',
    REVIEW: 'Em Revisão',
    GENERATING_PDF: 'Gerando PDF',
    APPROVED: 'Aprovado',
    REJECTED: 'Rejeitado',
    CANCELED: 'Cancelado',
    SUPERSEDED: 'Retificado',
}

const statusVariants: Record<
    JobStatus,
    'default' | 'secondary' | 'destructive' | 'outline'
> = {
    DRAFT: 'secondary',
    IN_PROGRESS: 'default',
    REVIEW: 'outline',
    GENERATING_PDF: 'outline',
    APPROVED: 'default',
    REJECTED: 'destructive',
    CANCELED: 'secondary',
    SUPERSEDED: 'outline',
}

function formatDate(dateString: string | null | undefined): string {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    })
}

function formatDateTime(dateString: string | null | undefined): string {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

function getFinancialVariant(status: string | null | undefined) {
    switch (status) {
        case 'PAID':
            return 'outline'
        case 'OVERDUE':
            return 'destructive'
        case 'ISSUED':
            return 'default'
        case 'DRAFT':
            return 'secondary'
        case 'UNBILLED':
        default:
            return 'secondary'
    }
}

interface Technician {
    id: string
    name: string
    email: string
    role: string
}

function JobDetailPage() {
    const { id } = Route.useParams()
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    // Dialog states
    const [approveDialogOpen, setApproveDialogOpen] = useState(false)
    const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
    const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
    const [assignDialogOpen, setAssignDialogOpen] = useState(false)
    const [rejectReason, setRejectReason] = useState('')
    const [cancelReason, setCancelReason] = useState('')
    const [selectedTechnician, setSelectedTechnician] = useState<string>('')
    const [envJustification, setEnvJustification] = useState('')

    // Stable callback for refreshing job data (used by ApprovedJobRecord for label polling)
    const refreshJob = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['jobs', id] })
    }, [queryClient, id])

    // Fetch job
    const {
        data: job,
        isLoading,
        error,
    } = useQuery({
        queryKey: ['jobs', id],
        queryFn: async () => {
            const res = await api.api.jobs[':id'].$get({
                param: { id },
            })
            if (!res.ok) {
                throw new Error('Falha ao carregar job')
            }
            return res.json()
        },
        // Auto-refresh every 2s while PDF is being generated
        refetchInterval: (query) => {
            const status = query.state.data?.status
            return status === 'GENERATING_PDF' ? 2000 : false
        },
    })

    // Fetch technicians for assign dialog
    const { data: techniciansData } = useQuery({
        queryKey: ['technicians'],
        queryFn: async () => {
            const res = await api.api.jobs['technicians'].list.$get()
            if (!res.ok) throw new Error('Falha ao carregar técnicos')
            const data = await res.json()
            return data.data as Technician[]
        },
        enabled: assignDialogOpen,
    })

    // Approve mutation
    const approveMutation = useMutation({
        mutationFn: async () => {
            const res = await api.api.jobs[':id'].approve.$post({
                param: { id },
                json: {
                    reason: 'Aprovado',
                    environmentalJustification: envJustification || undefined,
                },
            })
            if (!res.ok) {
                const error = await res.json()
                throw new Error((error as { error?: string }).error || 'Erro ao aprovar')
            }
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['jobs'] })
            toast.success('Job aprovado com sucesso!')
            setApproveDialogOpen(false)
            setEnvJustification('')
        },
        onError: (error) => {
            toast.error(error.message)
        },
    })

    // Reject mutation
    const rejectMutation = useMutation({
        mutationFn: async () => {
            const res = await api.api.jobs[':id'].reject.$post({
                param: { id },
                json: { reason: rejectReason },
            })
            if (!res.ok) {
                const error = await res.json()
                throw new Error((error as { error?: string }).error || 'Erro ao rejeitar')
            }
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['jobs'] })
            toast.success('Job rejeitado')
            setRejectDialogOpen(false)
            setRejectReason('')
        },
        onError: (error) => {
            toast.error(error.message)
        },
    })

    // Cancel mutation
    const cancelMutation = useMutation({
        mutationFn: async () => {
            const res = await api.api.jobs[':id'].$delete({
                param: { id },
                json: { reason: cancelReason },
            })
            if (!res.ok) {
                const error = await res.json()
                throw new Error((error as { error?: string }).error || 'Erro ao cancelar')
            }
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['jobs'] })
            toast.success('Job cancelado')
            setCancelDialogOpen(false)
            setCancelReason('')
            navigate({ to: '/dashboard/jobs' })
        },
        onError: (error) => {
            toast.error(error.message)
        },
    })

    // Assign mutation
    const assignMutation = useMutation({
        mutationFn: async () => {
            const res = await api.api.jobs[':id'].assign.$post({
                param: { id },
                json: { technicianId: selectedTechnician },
            })
            if (!res.ok) {
                const error = await res.json()
                throw new Error((error as { error?: string }).error || 'Erro ao atribuir')
            }
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['jobs', id] })
            toast.success('Técnico atribuído com sucesso!')
            setAssignDialogOpen(false)
            setSelectedTechnician('')
        },
        onError: (error) => {
            toast.error(error.message)
        },
    })

    if (isLoading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-8 w-48" />
                <Card>
                    <CardContent className="pt-6 space-y-4">
                        <Skeleton className="h-6 w-full" />
                        <Skeleton className="h-6 w-3/4" />
                        <Skeleton className="h-6 w-1/2" />
                    </CardContent>
                </Card>
            </div>
        )
    }

    if (error || !job) {
        return (
            <Card>
                <CardContent className="pt-6">
                    <p className="text-red-500">
                        Erro ao carregar job: {error?.message || 'Job não encontrado'}
                    </p>
                </CardContent>
            </Card>
        )
    }

    const canExecute = ['DRAFT', 'IN_PROGRESS', 'REJECTED'].includes(job.status)
    const canApprove = job.status === 'REVIEW'
    const canReject = job.status === 'REVIEW'
    const canCancel = ['DRAFT', 'IN_PROGRESS', 'REVIEW', 'REJECTED'].includes(job.status)
    const canAssign = ['DRAFT', 'IN_PROGRESS', 'REJECTED'].includes(job.status)
    const financialStatus =
        typeof job.financialStatus === 'string' ? job.financialStatus : 'UNBILLED'

    // APPROVED or SUPERSEDED status: Show immutable Quality Record view
    if (job.status === 'APPROVED' || job.status === 'SUPERSEDED') {
        return (
            <ApprovedJobRecord
                job={job as Parameters<typeof ApprovedJobRecord>[0]['job']}
                onBack={() => navigate({ to: '/dashboard/jobs' })}
                onRefresh={refreshJob}
            />
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate({ to: '/dashboard/jobs' })}
                    >
                        <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
                        Voltar
                    </Button>
                </div>

                <div className="flex items-center gap-2">
                    {/* Approve/Reject buttons for REVIEW status */}
                    {canApprove && (
                        <Button
                            variant="default"
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() => setApproveDialogOpen(true)}
                        >
                            <HugeiconsIcon icon={CheckmarkCircle02Icon} className="mr-2 h-4 w-4" />
                            Aprovar
                        </Button>
                    )}
                    {canReject && (
                        <Button
                            variant="destructive"
                            onClick={() => setRejectDialogOpen(true)}
                        >
                            <HugeiconsIcon icon={MultiplicationSignIcon} className="mr-2 h-4 w-4" />
                            Rejeitar
                        </Button>
                    )}

                    {/* Execute button */}
                    {canExecute && (
                        <Button
                            render={
                                <Link to="/dashboard/jobs/$id/execute" params={{ id }} />
                            }
                        >
                            <HugeiconsIcon icon={Calendar03Icon} className="mr-2 h-4 w-4" />
                            {job.status === 'DRAFT' ? 'Iniciar Execução' : 'Continuar Execução'}
                        </Button>
                    )}

                    {/* Assign technician */}
                    {canAssign && (
                        <Button variant="outline" onClick={() => setAssignDialogOpen(true)}>
                            <HugeiconsIcon icon={UserAdd01Icon} className="mr-2 h-4 w-4" />
                            Atribuir Técnico
                        </Button>
                    )}

                    {/* Edit button */}
                    {job.status === 'DRAFT' && (
                        <Button variant="outline">
                            <HugeiconsIcon icon={Edit02Icon} className="mr-2 h-4 w-4" />
                            Editar
                        </Button>
                    )}

                    {/* Cancel button */}
                    {canCancel && (
                        <Button
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setCancelDialogOpen(true)}
                        >
                            <HugeiconsIcon icon={Cancel01Icon} className="mr-2 h-4 w-4" />
                            Cancelar
                        </Button>
                    )}
                </div>
            </div>

            {/* Amendment Info Banner - ISO 17025 Clause 7.8.4.1 */}
            {job.supersedesId && (
                <Card className="border-amber-300 bg-amber-50">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2 text-amber-700">
                            <HugeiconsIcon icon={Edit02Icon} className="h-5 w-5" />
                            Retificação de Certificado
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <p className="text-sm text-amber-700">
                            Esta ordem de serviço é uma <strong>retificação</strong> (versão {job.amendmentNumber || 1}) que substituirá o certificado original após aprovação.
                        </p>
                        {job.amendmentReason && (
                            <div className="mt-3 p-3 bg-white/60 rounded-md border border-amber-200">
                                <p className="text-xs font-medium text-amber-800 mb-1">Motivo da retificação:</p>
                                <p className="text-sm text-amber-900">{job.amendmentReason}</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Job Header Card */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-2xl font-mono">{job.jobId}</CardTitle>
                            <CardDescription>
                                {job.serviceName}
                                {job.methodSnapshot.methodName && (
                                    <span className="text-xs ml-2">
                                        ({job.methodSnapshot.methodName} v{job.methodSnapshot.methodVersion})
                                    </span>
                                )}
                            </CardDescription>
                        </div>
                        <div className="text-right">
                            <Badge
                                variant={statusVariants[job.status as JobStatus]}
                                className={job.status === 'GENERATING_PDF' ? 'bg-amber-100 text-amber-700 border-amber-300 animate-pulse dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700' : ''}
                            >
                                {job.status === 'GENERATING_PDF' ? (
                                    <span className="inline-flex items-center gap-1">
                                        <Spinner className="size-3" />
                                        Gerando PDF...
                                    </span>
                                ) : (
                                    statusLabels[job.status as JobStatus]
                                )}
                            </Badge>
                            {job.isOverdue && (
                                <Badge variant="destructive" className="ml-2">
                                    Atrasado
                                </Badge>
                            )}
                            <Badge
                                variant={getFinancialVariant(financialStatus)}
                                className="ml-2"
                            >
                                {getFinancialStatusLabel(
                                    financialStatus as
                                        | 'UNBILLED'
                                        | 'DRAFT'
                                        | 'ISSUED'
                                        | 'PAID'
                                        | 'OVERDUE',
                                )}
                            </Badge>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Contexto Financeiro</CardTitle>
                        <CardDescription>
                            Visibilidade operacional da cobrança vinculada à OS.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <label className="text-sm font-medium text-muted-foreground">
                                Status financeiro
                            </label>
                            <p className="text-sm">
                                {getFinancialStatusLabel(
                                    financialStatus as
                                        | 'UNBILLED'
                                        | 'DRAFT'
                                        | 'ISSUED'
                                        | 'PAID'
                                        | 'OVERDUE',
                                )}
                            </p>
                        </div>
                        <div>
                            <label className="text-sm font-medium text-muted-foreground">
                                Elegível para cobrança
                            </label>
                            <p className="text-sm">{job.invoiceEligibility ? 'Sim' : 'Não'}</p>
                        </div>
                        <div>
                            <label className="text-sm font-medium text-muted-foreground">
                                Documento vinculado
                            </label>
                            <p className="text-sm">
                                {job.invoiceDocumentNumber || 'Ainda não faturada'}
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Customer & Asset */}
                <Card>
                    <CardHeader>
                        <CardTitle>Cliente e Ativo</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <label className="text-sm font-medium text-muted-foreground">
                                Cliente
                            </label>
                            <p className="text-sm">{job.customerName || '-'}</p>
                        </div>
                        <div>
                            <label className="text-sm font-medium text-muted-foreground">
                                Ativo
                            </label>
                            <p className="text-sm">
                                {job.assetName}
                                {job.assetTag && (
                                    <span className="font-mono text-muted-foreground ml-2">
                                        ({job.assetTag})
                                    </span>
                                )}
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Dates & Assignment */}
                <Card>
                    <CardHeader>
                        <CardTitle>Datas e Atribuição</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <label className="text-sm font-medium text-muted-foreground">
                                Técnico Responsável
                            </label>
                            <p className="text-sm">
                                {job.technicianName || (
                                    <span className="text-muted-foreground italic">
                                        Não atribuído
                                    </span>
                                )}
                            </p>
                        </div>
                        <div>
                            <label className="text-sm font-medium text-muted-foreground">
                                Prazo
                            </label>
                            <p className="text-sm">
                                {formatDate(job.dueDate)}
                                {job.daysUntilDue !== null && job.daysUntilDue > 0 && (
                                    <Badge variant="outline" className="ml-2 text-xs">
                                        {job.daysUntilDue} dias
                                    </Badge>
                                )}
                            </p>
                        </div>
                        {job.performedAt && (
                            <div>
                                <label className="text-sm font-medium text-muted-foreground">
                                    Executado em
                                </label>
                                <p className="text-sm">{formatDateTime(job.performedAt)}</p>
                            </div>
                        )}
                        {job.approvedAt && (
                            <div>
                                <label className="text-sm font-medium text-muted-foreground">
                                    Aprovado em
                                </label>
                                <p className="text-sm">{formatDateTime(job.approvedAt)}</p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Method Configuration Preview */}
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>Configuração do Método</CardTitle>
                        <CardDescription>
                            Snapshot do método capturado no momento da criação do job
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-4 md:grid-cols-3">
                            <div>
                                <label className="text-sm font-medium text-muted-foreground">
                                    Campos de Entrada
                                </label>
                                <p className="text-2xl font-bold">
                                    {(job.methodSnapshot as { dataFields?: unknown[] })?.dataFields
                                        ?.length || 0}
                                </p>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-muted-foreground">
                                    Fórmulas
                                </label>
                                <p className="text-2xl font-bold">
                                    {(job.methodSnapshot as { formulas?: unknown[] })?.formulas
                                        ?.length || 0}
                                </p>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-muted-foreground">
                                    Critérios de Aceitação
                                </label>
                                <p className="text-2xl font-bold">
                                    {(job.methodSnapshot as { validations?: unknown[] })?.validations
                                        ?.length || 0}
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Rejection Info */}
                {job.status === 'REJECTED' && job.rejectionReason && (
                    <Card className="md:col-span-2 border-destructive">
                        <CardHeader>
                            <CardTitle className="text-destructive">
                                Motivo da Rejeição
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm">{job.rejectionReason}</p>
                            {job.rejectedAt && (
                                <p className="text-xs text-muted-foreground mt-2">
                                    Rejeitado em {formatDateTime(job.rejectedAt)}
                                </p>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Metadata */}
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>Metadados</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex gap-8 text-sm text-muted-foreground">
                            <div>
                                <span className="font-medium">Criado em:</span>{' '}
                                {formatDateTime(job.createdAt)}
                            </div>
                            <div>
                                <span className="font-medium">Atualizado em:</span>{' '}
                                {formatDateTime(job.updatedAt)}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Approve Dialog */}
            <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Aprovar Job</DialogTitle>
                        <DialogDescription>
                            Tem certeza que deseja aprovar este job? Esta ação não pode ser desfeita.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Environmental out-of-limits warning */}
                    {job?.environmentalSnapshot && !job.environmentalSnapshot.withinLimits && (
                        <div className="space-y-3">
                            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
                                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                                    Condições ambientais fora dos limites
                                </p>
                                <div className="mt-1 text-xs text-amber-700 dark:text-amber-300 space-y-0.5">
                                    {job.environmentalSnapshot.temperature != null && job.environmentalSnapshot.limits?.temperature && (
                                        <p>
                                            Temperatura: {job.environmentalSnapshot.temperature} °C
                                            (limite: {job.environmentalSnapshot.limits.temperature.min}–{job.environmentalSnapshot.limits.temperature.max} °C)
                                        </p>
                                    )}
                                    {job.environmentalSnapshot.humidity != null && job.environmentalSnapshot.limits?.humidity && (
                                        <p>
                                            Umidade: {job.environmentalSnapshot.humidity} %RH
                                            (limite: {job.environmentalSnapshot.limits.humidity.min}–{job.environmentalSnapshot.limits.humidity.max} %RH)
                                        </p>
                                    )}
                                    {job.environmentalSnapshot.pressure != null && job.environmentalSnapshot.limits?.pressure && (
                                        <p>
                                            Pressão: {job.environmentalSnapshot.pressure} hPa
                                            (limite: {job.environmentalSnapshot.limits.pressure.min}–{job.environmentalSnapshot.limits.pressure.max} hPa)
                                        </p>
                                    )}
                                </div>
                            </div>
                            <Field>
                                <FieldLabel>Justificativa (obrigatória)</FieldLabel>
                                <Textarea
                                    placeholder="Justifique a aprovação com condições fora dos limites..."
                                    value={envJustification}
                                    onChange={(e) => setEnvJustification(e.target.value)}
                                    rows={3}
                                />
                            </Field>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setApproveDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() => approveMutation.mutate()}
                            disabled={
                                approveMutation.isPending ||
                                (!!job?.environmentalSnapshot &&
                                    !job.environmentalSnapshot.withinLimits &&
                                    !job.environmentalSnapshot.outOfLimitsJustification &&
                                    !envJustification.trim())
                            }
                        >
                            {approveMutation.isPending && <Spinner className="mr-2" />}
                            {approveMutation.isPending ? 'Aprovando...' : 'Aprovar'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Reject Dialog */}
            <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Rejeitar Job</DialogTitle>
                        <DialogDescription>
                            Informe o motivo da rejeição. O técnico poderá corrigir e reenviar.
                        </DialogDescription>
                    </DialogHeader>
                    <Field>
                        <FieldLabel>Motivo da Rejeição *</FieldLabel>
                        <Textarea
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Descreva o motivo da rejeição..."
                            rows={4}
                        />
                    </Field>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => rejectMutation.mutate()}
                            disabled={rejectMutation.isPending || !rejectReason.trim()}
                        >
                            {rejectMutation.isPending ? 'Rejeitando...' : 'Rejeitar'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Cancel Dialog */}
            <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Cancelar Job</DialogTitle>
                        <DialogDescription>
                            Tem certeza que deseja cancelar este job? Esta ação não pode ser desfeita.
                        </DialogDescription>
                    </DialogHeader>
                    <Field>
                        <FieldLabel>Motivo do Cancelamento *</FieldLabel>
                        <Textarea
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            placeholder="Descreva o motivo do cancelamento..."
                            rows={4}
                        />
                    </Field>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
                            Voltar
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => cancelMutation.mutate()}
                            disabled={cancelMutation.isPending || !cancelReason.trim()}
                        >
                            {cancelMutation.isPending ? 'Cancelando...' : 'Confirmar Cancelamento'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Assign Technician Dialog */}
            <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Atribuir Técnico</DialogTitle>
                        <DialogDescription>
                            Selecione o técnico responsável pela execução deste job.
                        </DialogDescription>
                    </DialogHeader>
                    <Field>
                        <FieldLabel>Técnico</FieldLabel>
                        <Select
                            value={selectedTechnician}
                            onValueChange={(value) => setSelectedTechnician(value ?? '')}
                        >
                            <SelectTrigger>
                                <span>
                                    {selectedTechnician
                                        ? techniciansData?.find((t) => t.id === selectedTechnician)?.name
                                        : 'Selecione um técnico...'}
                                </span>
                            </SelectTrigger>
                            <SelectContent>
                                {techniciansData?.map((tech) => (
                                    <SelectItem key={tech.id} value={tech.id}>
                                        {tech.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={() => assignMutation.mutate()}
                            disabled={assignMutation.isPending || !selectedTechnician}
                        >
                            {assignMutation.isPending ? 'Atribuindo...' : 'Atribuir'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
