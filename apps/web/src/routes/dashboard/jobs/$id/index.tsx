import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
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
    | 'APPROVED'
    | 'REJECTED'
    | 'CANCELED'

const statusLabels: Record<JobStatus, string> = {
    DRAFT: 'Rascunho',
    IN_PROGRESS: 'Em Execução',
    REVIEW: 'Em Revisão',
    APPROVED: 'Aprovado',
    REJECTED: 'Rejeitado',
    CANCELED: 'Cancelado',
}

const statusVariants: Record<
    JobStatus,
    'default' | 'secondary' | 'destructive' | 'outline'
> = {
    DRAFT: 'secondary',
    IN_PROGRESS: 'default',
    REVIEW: 'outline',
    APPROVED: 'default',
    REJECTED: 'destructive',
    CANCELED: 'secondary',
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
                json: { reason: 'Aprovado' },
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

    // APPROVED status: Show immutable Quality Record view
    if (job.status === 'APPROVED') {
        return (
            <ApprovedJobRecord
                job={job as Parameters<typeof ApprovedJobRecord>[0]['job']}
                onBack={() => navigate({ to: '/dashboard/jobs' })}
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
                            <Badge variant={statusVariants[job.status as JobStatus]}>
                                {statusLabels[job.status as JobStatus]}
                            </Badge>
                            {job.isOverdue && (
                                <Badge variant="destructive" className="ml-2">
                                    Atrasado
                                </Badge>
                            )}
                        </div>
                    </div>
                </CardHeader>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
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
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setApproveDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() => approveMutation.mutate()}
                            disabled={approveMutation.isPending}
                        >
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
