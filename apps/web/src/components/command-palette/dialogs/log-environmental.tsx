import { HugeiconsIcon } from '@hugeicons/react'
import { AlertCircleIcon } from '@hugeicons/core-free-icons'

import { useCommandPalette } from '../command-context'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function LogEnvironmentalDialog() {
  const { environmentalDialogOpen, setEnvironmentalDialogOpen } =
    useCommandPalette()

  const handleOpenChange = (open: boolean) => {
    setEnvironmentalDialogOpen(open)
  }

  return (
    <Dialog open={environmentalDialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar Condições Ambientais</DialogTitle>
          <DialogDescription>
            Registre a temperatura e umidade do ambiente de calibração para
            rastreabilidade ISO 17025.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-8">
          <div className="rounded-full bg-muted p-4">
            <HugeiconsIcon
              icon={AlertCircleIcon}
              className="size-8 text-muted-foreground"
            />
          </div>
          <div className="text-center">
            <p className="text-lg font-medium">Em breve</p>
            <p className="text-sm text-muted-foreground">
              Esta funcionalidade está em desenvolvimento e estará disponível em
              uma próxima atualização.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
