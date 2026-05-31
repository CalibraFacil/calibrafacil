import { isDesktopRuntime } from '@calibra-facil/client-runtime'
import { PrinterIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

import { PrinterSettingsDialog } from './printer-settings-dialog'
import { usePrinterProfiles, usePrintJobLabel } from './use-printers'

/**
 * "Imprimir Etiqueta (térmica)" action. Desktop-only in this phase: it prints
 * native ZPL straight to the configured Zebra printer via the local-server.
 * Cloud runtimes keep the existing PDF label download (Zebra Browser Print is a
 * later phase), so this renders nothing outside desktop.
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
  const profilesQuery = usePrinterProfiles(isDesktop)
  const printMutation = usePrintJobLabel()

  if (!isDesktop) {
    return null
  }

  const hasPrinter = (profilesQuery.data?.length ?? 0) > 0

  const handlePrint = () => {
    if (!hasPrinter) {
      toast.info('Configure uma impressora térmica para imprimir etiquetas.')
      setSettingsOpen(true)
      return
    }
    printMutation.mutate(
      { jobId },
      {
        onSuccess: () => toast.success('Etiqueta enviada para impressão.'),
        onError: (error) =>
          toast.error(
            error instanceof Error
              ? error.message
              : 'Falha ao imprimir etiqueta',
          ),
      },
    )
  }

  return (
    <>
      <Button
        variant="outline"
        className={className}
        onClick={handlePrint}
        disabled={disabled || printMutation.isPending}
      >
        {printMutation.isPending ? (
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
