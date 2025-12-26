import * as React from 'react'
import { toast } from 'sonner'

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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { mockClients } from '@/lib/mock/clients'

const equipmentTypes = [
  { id: 'balance', name: 'Balança' },
  { id: 'thermometer', name: 'Termômetro' },
  { id: 'manometer', name: 'Manômetro' },
  { id: 'caliper', name: 'Paquímetro' },
  { id: 'micrometer', name: 'Micrômetro' },
  { id: 'multimeter', name: 'Multímetro' },
  { id: 'pipette', name: 'Pipeta' },
  { id: 'other', name: 'Outro' },
]

const conditions = [
  { id: 'good', name: 'Bom estado' },
  { id: 'minor_issues', name: 'Pequenos problemas visíveis' },
  { id: 'damaged', name: 'Danificado' },
  { id: 'needs_inspection', name: 'Necessita inspeção detalhada' },
]

export function RegisterEquipmentDialog() {
  const { equipmentDialogOpen, setEquipmentDialogOpen } = useCommandPalette()
  const [clientId, setClientId] = React.useState('')
  const [equipmentType, setEquipmentType] = React.useState('')
  const [serialNumber, setSerialNumber] = React.useState('')
  const [manufacturer, setManufacturer] = React.useState('')
  const [model, setModel] = React.useState('')
  const [condition, setCondition] = React.useState('')
  const [observations, setObservations] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500))

    const client = mockClients.find((c) => c.id === clientId)
    const type = equipmentTypes.find((t) => t.id === equipmentType)

    toast.success('Ativo registrado com sucesso', {
      description: `${type?.name} - NS: ${serialNumber} | Cliente: ${client?.name}`,
    })

    setIsSubmitting(false)
    resetForm()
    setEquipmentDialogOpen(false)
  }

  const resetForm = () => {
    setClientId('')
    setEquipmentType('')
    setSerialNumber('')
    setManufacturer('')
    setModel('')
    setCondition('')
    setObservations('')
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      resetForm()
    }
    setEquipmentDialogOpen(open)
  }

  return (
    <Dialog open={equipmentDialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar Entrada de Ativo</DialogTitle>
          <DialogDescription>
            Registre a entrada de um novo ativo para calibração. Este formulário
            cria o registro inicial no sistema.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="client">Cliente</Label>
            <NativeSelect
              id="client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              required
            >
              <option value="">Selecione o cliente...</option>
              {mockClients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="equipment-type">Tipo de Ativo</Label>
              <NativeSelect
                id="equipment-type"
                value={equipmentType}
                onChange={(e) => setEquipmentType(e.target.value)}
                required
              >
                <option value="">Selecione...</option>
                {equipmentTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="serial-number">Número de Série</Label>
              <Input
                id="serial-number"
                placeholder="SN-2024-XXX"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="manufacturer">Fabricante</Label>
              <Input
                id="manufacturer"
                placeholder="Ex: Mettler Toledo"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="model">Modelo</Label>
              <Input
                id="model"
                placeholder="Ex: XPE205"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="condition">Condição na Chegada</Label>
            <NativeSelect
              id="condition"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              required
            >
              <option value="">Selecione a condição...</option>
              {conditions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="observations">Observações</Label>
            <Textarea
              id="observations"
              placeholder="Observações adicionais sobre o ativo..."
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Registrando...' : 'Registrar Entrada'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
