import { HugeiconsIcon } from '@hugeicons/react'
import {
  PrinterIcon,
  Mail01Icon,
  Edit02Icon,
  ArrowLeft01Icon,
  MoreVerticalIcon,
} from '@hugeicons/core-free-icons'
import { Button } from '@calibra-facil/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@calibra-facil/ui/dropdown-menu'
import {
  REVIEW_ACTION_BUTTON_CLASS,
  type ApprovedJobRecordData,
} from '@/features/jobs/detail-model'
import { useOperationAvailability } from '@/runtime/use-operation-availability'

type Availability = ReturnType<typeof useOperationAvailability>

export function ApprovedRecordToolbar({
  job,
  onBack,
  labelPending,
  isGeneratingLabel,
  isDownloadingLabel,
  amendAvailability,
  handleDownloadLabel,
  handleGenerateLabel,
  setIsAmendDialogOpen,
}: {
  job: ApprovedJobRecordData
  onBack: () => void
  labelPending: boolean
  isGeneratingLabel: boolean
  isDownloadingLabel: boolean
  amendAvailability: Availability
  handleDownloadLabel: () => void
  handleGenerateLabel: () => void
  setIsAmendDialogOpen: (open: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className={`${REVIEW_ACTION_BUTTON_CLASS} w-fit shrink-0`}
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
        Voltar
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={(props) => (
            <Button
              variant="outline"
              size="icon"
              aria-label="Mais ações"
              className={`${REVIEW_ACTION_BUTTON_CLASS} size-10 shadow-[0_1px_2px_rgba(15,23,42,0.08)]`}
              {...props}
            >
              <HugeiconsIcon icon={MoreVerticalIcon} className="h-4 w-4" />
            </Button>
          )}
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Distribuição</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={job.labelUrl ? handleDownloadLabel : handleGenerateLabel}
              disabled={isGeneratingLabel || isDownloadingLabel || labelPending}
            >
              <HugeiconsIcon icon={PrinterIcon} className="h-4 w-4" />
              {labelPending
                ? 'Gerando...'
                : job.labelUrl
                  ? 'Baixar Etiqueta'
                  : 'Gerar Etiqueta QR'}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <HugeiconsIcon icon={Mail01Icon} className="h-4 w-4" />
              Enviar por Email
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {job.status !== 'SUPERSEDED' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Mais opções</DropdownMenuLabel>
                <DropdownMenuItem
                  className="text-muted-foreground"
                  disabled={!amendAvailability.available}
                  onClick={() => setIsAmendDialogOpen(true)}
                >
                  <HugeiconsIcon icon={Edit02Icon} className="h-4 w-4" />
                  Retificar Certificado
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
