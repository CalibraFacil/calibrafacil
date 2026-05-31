import { PrinterIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'
import { toast } from 'sonner'

import { isDesktopRuntime } from '@calibra-facil/client-runtime'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

import { isBrowserPrintAvailable } from './browser-print'
import { PrinterSettingsDialog } from './printer-settings-dialog'
import {
  usePrinterProfiles,
  usePrintJobLabel,
  usePrintJobLabelViaBrowserPrint,
} from './use-printers'

const reportSuccess = () => toast.success('Etiqueta enviada para impressão.')
const reportError = (error: unknown) =>
  toast.error(
    error instanceof Error ? error.message : 'Falha ao imprimir etiqueta',
  )

/**
 * "Imprimir Etiqueta (térmica)" action — native ZPL straight to a Zebra printer.
 * Desktop runtime prints via the local-server (configured network printer);
 * cloud runtime prints via the Zebra Browser Print agent. When no printer is
 * configured / the agent is absent, it opens the settings dialog (which guides
 * setup). The existing PDF "Baixar Etiqueta QR" remains the universal fallback.
 */
export function PrintLabelButton({
  jobId,
  className,
  disabled,
}: {
  jobId: string | number
  className?: string
  disabled?: boolean
}) {
  const isDesktop = isDesktopRuntime()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isCloudWorking, setIsCloudWorking] = useState(false)

  const profilesQuery = usePrinterProfiles(isDesktop)
  const printDesktop = usePrintJobLabel()
  const printCloud = usePrintJobLabelViaBrowserPrint()

  const isWorking = isDesktop ? printDesktop.isPending : isCloudWorking

  const printDesktopLabel = () => {
    if ((profilesQuery.data?.length ?? 0) === 0) {
      toast.info('Configure uma impressora térmica para imprimir etiquetas.')
      setSettingsOpen(true)
      return
    }
    printDesktop.mutate(
      { jobId },
      { onSuccess: reportSuccess, onError: reportError },
    )
  }

  const printCloudLabel = async () => {
    setIsCloudWorking(true)
    try {
      if (!(await isBrowserPrintAvailable())) {
        toast.info(
          'Instale o Zebra Browser Print para imprimir etiquetas térmicas.',
        )
        setSettingsOpen(true)
        return
      }
      await printCloud.mutateAsync({ jobId })
      reportSuccess()
    } catch (error) {
      reportError(error)
    } finally {
      setIsCloudWorking(false)
    }
  }

  const handlePrint = () => {
    if (isDesktop) {
      printDesktopLabel()
    } else {
      void printCloudLabel()
    }
  }

  return (
    <>
      <Button
        variant="outline"
        className={className}
        onClick={handlePrint}
        disabled={disabled || isWorking}
      >
        {isWorking ? (
          <Spinner className="mr-2 h-4 w-4" />
        ) : (
          <HugeiconsIcon icon={PrinterIcon} className="mr-2 h-4 w-4" />
        )}
        Imprimir Etiqueta (térmica)
      </Button>
      <Button
        variant="ghost"
        className="h-auto justify-start px-2 text-xs text-muted-foreground"
        onClick={() => setSettingsOpen(true)}
      >
        Configurar impressora
      </Button>
      <PrinterSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </>
  )
}
