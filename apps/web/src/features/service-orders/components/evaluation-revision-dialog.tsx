import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'

/**
 * Captures the motivo for changing an evaluation the customer has already been
 * quoted from. The reason is mandatory here because the API refuses a locked
 * revision without one — the dialog exists so the operator is asked before the
 * request, not after it comes back 409.
 */
export function EvaluationRevisionDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reason: string) => void
  pending?: boolean
}) {
  const [reason, setReason] = useState('')
  const trimmed = reason.trim()

  function handleOpenChange(next: boolean) {
    // Drop a half-typed reason when the dialog is dismissed, so reopening it
    // never silently reuses stale text.
    if (!next) setReason('')
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revisar avaliação técnica</DialogTitle>
          <DialogDescription>
            O orçamento enviado ao cliente se baseia nesta avaliação. A revisão
            fica registrada no histórico da OS.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="evaluation-revision-reason">
              Motivo da revisão
            </FieldLabel>
            <Textarea
              id="evaluation-revision-reason"
              className="min-h-24 resize-y"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ex.: diagnóstico corrigido após novo teste na bancada."
              disabled={pending}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" disabled={pending}>
                Cancelar
              </Button>
            }
          />
          <Button
            className="transition-transform active:scale-[0.96]"
            onClick={() => onConfirm(trimmed)}
            disabled={pending || trimmed.length === 0}
          >
            Salvar revisão
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
