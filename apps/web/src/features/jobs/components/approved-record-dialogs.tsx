import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@calibra-facil/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@calibra-facil/ui/dialog'
import { Checkbox } from '@calibra-facil/ui/checkbox'
import { Label } from '@calibra-facil/ui/label'
import { Textarea } from '@calibra-facil/ui/textarea'
import { Spinner } from '@calibra-facil/ui/spinner'
import type { Dispatch, SetStateAction } from 'react'

export function AmendCertificateDialog({
  isAmendDialogOpen,
  setIsAmendDialogOpen,
  amendmentReason,
  setAmendmentReason,
  isAmending,
  handleAmendCertificate,
}: {
  isAmendDialogOpen: boolean
  setIsAmendDialogOpen: Dispatch<SetStateAction<boolean>>
  amendmentReason: string
  setAmendmentReason: Dispatch<SetStateAction<string>>
  isAmending: boolean
  handleAmendCertificate: () => void
}) {
  return (
    <Dialog open={isAmendDialogOpen} onOpenChange={setIsAmendDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon
              icon={Alert02Icon}
              className="h-5 w-5 text-amber-500"
            />
            Retificar Certificado
          </DialogTitle>
          <DialogDescription>
            Esta ação criará uma nova versão do certificado e marcará o atual
            como <strong>CANCELADO</strong>. Esta operação é irreversível e será
            registrada no histórico de auditoria.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm text-amber-800">
              Quando um certificado emitido precisar ser alterado, cada
              alteração deve ser identificada e conter referência ao original.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="amendment-reason">
              Motivo da Retificação <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="amendment-reason"
              placeholder="Descreva o motivo da retificação (mínimo 10 caracteres)..."
              value={amendmentReason}
              onChange={(e) => setAmendmentReason(e.target.value)}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              {amendmentReason.length}/10 caracteres mínimos
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => {
              setIsAmendDialogOpen(false)
              setAmendmentReason('')
            }}
            disabled={isAmending}
          >
            Cancelar
          </Button>
          <Button
            variant="default"
            onClick={handleAmendCertificate}
            disabled={isAmending || amendmentReason.length < 10}
          >
            {isAmending ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                Criando...
              </>
            ) : (
              'Criar Retificação'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function OutOfToleranceDialog({
  isOotDialogOpen,
  setIsOotDialogOpen,
  ootDescription,
  setOotDescription,
  ootAffectedScope,
  setOotAffectedScope,
  ootNotifyCustomer,
  setOotNotifyCustomer,
  isFlaggingOot,
  handleFlagOutOfTolerance,
}: {
  isOotDialogOpen: boolean
  setIsOotDialogOpen: Dispatch<SetStateAction<boolean>>
  ootDescription: string
  setOotDescription: Dispatch<SetStateAction<string>>
  ootAffectedScope: string
  setOotAffectedScope: Dispatch<SetStateAction<string>>
  ootNotifyCustomer: boolean
  setOotNotifyCustomer: Dispatch<SetStateAction<boolean>>
  isFlaggingOot: boolean
  handleFlagOutOfTolerance: () => void
}) {
  return (
    <Dialog open={isOotDialogOpen} onOpenChange={setIsOotDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon
              icon={Alert02Icon}
              className="h-5 w-5 text-destructive"
            />
            Registrar não conformidade
          </DialogTitle>
          <DialogDescription>
            Abre uma não conformidade do tipo &quot;fora de tolerância&quot;
            para este resultado como encontrado e, se marcado, notifica o
            cliente.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="oot-description">Descrição (opcional)</Label>
            <Textarea
              id="oot-description"
              placeholder="Deixe em branco para gerar uma descrição padrão com os dados do job..."
              value={ootDescription}
              onChange={(e) => setOotDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="oot-affected-scope">
              Escopo potencialmente afetado (opcional)
            </Label>
            <Textarea
              id="oot-affected-scope"
              placeholder="Ex.: medições realizadas com o instrumento desde a última calibração..."
              value={ootAffectedScope}
              onChange={(e) => setOotAffectedScope(e.target.value)}
              rows={3}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="oot-notify-customer"
              checked={ootNotifyCustomer}
              onCheckedChange={(checked) =>
                setOotNotifyCustomer(checked === true)
              }
            />
            <Label
              htmlFor="oot-notify-customer"
              className="text-sm font-normal"
            >
              Notificar cliente (e-mail + PDF)
            </Label>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => setIsOotDialogOpen(false)}
            disabled={isFlaggingOot}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleFlagOutOfTolerance}
            disabled={isFlaggingOot}
          >
            {isFlaggingOot ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                Registrando...
              </>
            ) : (
              'Registrar NC'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
