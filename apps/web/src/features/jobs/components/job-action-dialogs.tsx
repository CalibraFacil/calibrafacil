import { Button } from '@calibra-facil/ui/button'
import { Textarea } from '@calibra-facil/ui/textarea'
import { Spinner } from '@calibra-facil/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@calibra-facil/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@calibra-facil/ui/select'
import { Field, FieldLabel } from '@calibra-facil/ui/field'
import { isJobApprovalBlockedByEnvironment } from '@/features/jobs/approval-model'
import type { Dispatch, SetStateAction } from 'react'
import type { useJobTechniciansData } from '@/features/jobs/queries'
import type { JobDetailData } from '../job-detail-types'

type MutationHandle = { isPending: boolean; mutate: () => void }
type StateSetter<T> = Dispatch<SetStateAction<T>>

export function ApproveJobDialog({
  job,
  approveDialogOpen,
  setApproveDialogOpen,
  envJustification,
  setEnvJustification,
  scopeViolationBlocked,
  setScopeViolationBlocked,
  scopeOverrideJustification,
  setScopeOverrideJustification,
  approveMutation,
}: {
  job: JobDetailData
  approveDialogOpen: boolean
  setApproveDialogOpen: StateSetter<boolean>
  envJustification: string
  setEnvJustification: StateSetter<string>
  scopeViolationBlocked: boolean
  setScopeViolationBlocked: StateSetter<boolean>
  scopeOverrideJustification: string
  setScopeOverrideJustification: StateSetter<string>
  approveMutation: MutationHandle
}) {
  return (
    <Dialog
      open={approveDialogOpen}
      onOpenChange={(open) => {
        setApproveDialogOpen(open)
        if (!open) {
          setScopeViolationBlocked(false)
          setScopeOverrideJustification('')
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aprovar Job</DialogTitle>
          <DialogDescription>
            Tem certeza que deseja aprovar este job? Esta ação não pode ser
            desfeita.
          </DialogDescription>
        </DialogHeader>

        {/* Environmental out-of-limits warning */}
        {job?.environmentalSnapshot &&
          !job.environmentalSnapshot.withinLimits && (
            <div className="space-y-3">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  Condições ambientais fora dos limites
                </p>
                <div className="mt-1 text-xs text-amber-700 dark:text-amber-300 space-y-0.5">
                  {job.environmentalSnapshot.temperature != null &&
                    job.environmentalSnapshot.limits?.temperature && (
                      <p>
                        Temperatura: {job.environmentalSnapshot.temperature} °C
                        (limite:{' '}
                        {job.environmentalSnapshot.limits.temperature.min}–
                        {job.environmentalSnapshot.limits.temperature.max} °C)
                      </p>
                    )}
                  {job.environmentalSnapshot.humidity != null &&
                    job.environmentalSnapshot.limits?.humidity && (
                      <p>
                        Umidade: {job.environmentalSnapshot.humidity} %RH
                        (limite: {job.environmentalSnapshot.limits.humidity.min}
                        –{job.environmentalSnapshot.limits.humidity.max} %RH)
                      </p>
                    )}
                  {job.environmentalSnapshot.pressure != null &&
                    job.environmentalSnapshot.limits?.pressure && (
                      <p>
                        Pressão: {job.environmentalSnapshot.pressure} hPa
                        (limite: {job.environmentalSnapshot.limits.pressure.min}
                        –{job.environmentalSnapshot.limits.pressure.max} hPa)
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

        {/* #427 Phase 1: scope-violation override (only after the server
              blocked with SCOPE_VIOLATION). Approving here issues WITHOUT
              the accreditation seal. */}
        {scopeViolationBlocked && (
          <div className="space-y-3">
            <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                Violação do escopo acreditado (CMC)
              </p>
              <p className="mt-1 text-xs text-red-700 dark:text-red-300">
                O resultado viola o escopo acreditado do laboratório. Para
                aprovar mesmo assim, justifique. O certificado será emitido sem
                o selo de acreditação.
              </p>
            </div>
            <Field>
              <FieldLabel>Justificativa (obrigatória)</FieldLabel>
              <Textarea
                placeholder="Justifique a emissão sem o selo de acreditação..."
                value={scopeOverrideJustification}
                onChange={(e) => setScopeOverrideJustification(e.target.value)}
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
              isJobApprovalBlockedByEnvironment(job, envJustification) ||
              (scopeViolationBlocked &&
                scopeOverrideJustification.trim().length === 0)
            }
          >
            {approveMutation.isPending && <Spinner className="mr-2" />}
            {approveMutation.isPending
              ? 'Aprovando...'
              : scopeViolationBlocked
                ? 'Aprovar sem selo'
                : 'Aprovar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RejectJobDialog({
  rejectDialogOpen,
  setRejectDialogOpen,
  rejectReason,
  setRejectReason,
  rejectMutation,
}: {
  rejectDialogOpen: boolean
  setRejectDialogOpen: StateSetter<boolean>
  rejectReason: string
  setRejectReason: StateSetter<string>
  rejectMutation: MutationHandle
}) {
  return (
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
  )
}

export function CancelJobDialog({
  cancelDialogOpen,
  setCancelDialogOpen,
  cancelReason,
  setCancelReason,
  cancelMutation,
}: {
  cancelDialogOpen: boolean
  setCancelDialogOpen: StateSetter<boolean>
  cancelReason: string
  setCancelReason: StateSetter<string>
  cancelMutation: MutationHandle
}) {
  return (
    <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar Calibração</DialogTitle>
          <DialogDescription>
            Tem certeza que deseja cancelar esta calibração? Esta ação não pode
            ser desfeita.
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
            {cancelMutation.isPending
              ? 'Cancelando...'
              : 'Confirmar Cancelamento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AssignTechnicianDialog({
  assignDialogOpen,
  setAssignDialogOpen,
  selectedTechnician,
  setSelectedTechnician,
  techniciansData,
  assignMutation,
}: {
  assignDialogOpen: boolean
  setAssignDialogOpen: StateSetter<boolean>
  selectedTechnician: string
  setSelectedTechnician: StateSetter<string>
  techniciansData: ReturnType<typeof useJobTechniciansData>['data']
  assignMutation: MutationHandle
}) {
  return (
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
                  ? techniciansData?.data.find(
                      (t) => t.id === selectedTechnician,
                    )?.name
                  : 'Selecione um técnico...'}
              </span>
            </SelectTrigger>
            <SelectContent>
              {techniciansData?.data.map((tech) => (
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
  )
}
