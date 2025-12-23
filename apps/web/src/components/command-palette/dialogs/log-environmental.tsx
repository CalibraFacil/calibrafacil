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

const mockRooms = [
  { id: 'room-1', name: 'Sala de Calibração Principal' },
  { id: 'room-2', name: 'Sala de Calibração Dimensional' },
  { id: 'room-3', name: 'Laboratório de Temperatura' },
  { id: 'room-4', name: 'Laboratório de Pressão' },
  { id: 'room-5', name: 'Sala de Recebimento' },
]

export function LogEnvironmentalDialog() {
  const { environmentalDialogOpen, setEnvironmentalDialogOpen } =
    useCommandPalette()
  const [temperature, setTemperature] = React.useState('')
  const [humidity, setHumidity] = React.useState('')
  const [room, setRoom] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const timestamp = React.useMemo(() => {
    return new Date().toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }, [environmentalDialogOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500))

    const roomName = mockRooms.find((r) => r.id === room)?.name || room

    toast.success('Condições ambientais registradas', {
      description: `${roomName}: ${temperature}°C, ${humidity}% UR`,
    })

    setIsSubmitting(false)
    setTemperature('')
    setHumidity('')
    setRoom('')
    setEnvironmentalDialogOpen(false)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setTemperature('')
      setHumidity('')
      setRoom('')
    }
    setEnvironmentalDialogOpen(open)
  }

  return (
    <Dialog open={environmentalDialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar Condições Ambientais</DialogTitle>
          <DialogDescription>
            Registre a temperatura e umidade do ambiente de calibração. Isso é
            essencial para a rastreabilidade ISO 17025.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="timestamp">Data/Hora</Label>
            <Input id="timestamp" value={timestamp} disabled />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="room">Local</Label>
            <NativeSelect
              id="room"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              required
            >
              <option value="">Selecione o local...</option>
              {mockRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="temperature">Temperatura (°C)</Label>
              <Input
                id="temperature"
                type="number"
                step="0.1"
                min="-10"
                max="50"
                placeholder="23.0"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="humidity">Umidade Relativa (%)</Label>
              <Input
                id="humidity"
                type="number"
                step="0.1"
                min="0"
                max="100"
                placeholder="50.0"
                value={humidity}
                onChange={(e) => setHumidity(e.target.value)}
                required
              />
            </div>
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
              {isSubmitting ? 'Registrando...' : 'Registrar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
