import { createFileRoute, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { api } from '@/utils/api'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute('/dashboard/assets/$id/')({
  head: () => ({
    meta: [{ title: 'Detalhes do Ativo | CalibraFacil' }],
  }),
  component: AssetDetailPage,
})

type AssetStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | 'SCRAPPED'

const statusLabels: Record<AssetStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  MAINTENANCE: 'Em Manutenção',
  SCRAPPED: 'Descartado',
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '-'
  const d = new Date(date)
  return d.toLocaleDateString('pt-BR')
}

function AssetDetailPage() {
  const { id } = useParams({ from: '/dashboard/assets/$id/' })

  const {
    data: asset,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['asset', id],
    queryFn: async () => {
      const res = await api.api.assets[':id'].$get({
        param: { id },
      })
      if (!res.ok) {
        throw new Error('Falha ao carregar ativo')
      }
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-48" />
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  if (error || !asset) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-destructive">
          Erro ao carregar informações do ativo.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Basic Information */}
      <Card>
        <CardHeader>
          <CardTitle>Informações Básicas</CardTitle>
          <CardDescription>Dados de identificação do ativo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Nome
            </label>
            <p className="text-sm">{asset.name}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Tag / ID Interno
            </label>
            <p className="font-mono text-sm">{asset.tag}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Número de Série
            </label>
            <p className="font-mono text-sm">{asset.serialNumber}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Fabricante
            </label>
            <p className="text-sm">{asset.manufacturer || '-'}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Modelo
            </label>
            <p className="text-sm">{asset.model || '-'}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Status
            </label>
            <p className="text-sm">
              <Badge variant="outline">
                {statusLabels[asset.status as AssetStatus]}
              </Badge>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Calibration Information */}
      <Card>
        <CardHeader>
          <CardTitle>Calibracao</CardTitle>
          <CardDescription>
            Informações sobre calibrações do ativo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Última Calibração
            </label>
            <p className="text-sm">{formatDate(asset.lastCalibrationDate)}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Próxima Calibração
            </label>
            <p className="text-sm">{formatDate(asset.nextCalibrationDate)}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Cliente
            </label>
            <p className="text-sm">{asset.customerName}</p>
          </div>
        </CardContent>
      </Card>

      {/* Comments */}
      {asset.comments && (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Observações</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{asset.comments}</p>
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
              {formatDate(asset.createdAt)}
            </div>
            <div>
              <span className="font-medium">Atualizado em:</span>{' '}
              {formatDate(asset.updatedAt)}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
