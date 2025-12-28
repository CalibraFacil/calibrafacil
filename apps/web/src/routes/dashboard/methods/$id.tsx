import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, Edit02Icon } from '@hugeicons/core-free-icons'
import type { MethodData } from '@/components/method-builder'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export const Route = createFileRoute('/dashboard/methods/$id')({
  head: () => ({
    meta: [{ title: 'Detalhes do Método | CalibraFacil' }],
  }),
  component: MethodDetailPage,
})

const statusLabels: Record<string, string> = {
  DRAFT: 'Rascunho',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Arquivado',
}

const statusVariants: Record<string, 'default' | 'secondary' | 'outline'> = {
  DRAFT: 'secondary',
  PUBLISHED: 'default',
  ARCHIVED: 'outline',
}

function MethodDetailPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()

  const {
    data: method,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['methods', id],
    queryFn: async () => {
      const res = await api.api.methods[':id'].$get({
        param: { id },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar método')
      }

      return res.json() as Promise<
        MethodData & {
          assetTypeName?: string
          createdByName?: string
          createdAt: string
          publishedAt?: string
          archivedAt?: string
        }
      >
    },
  })

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-500">
            Erro ao carregar método: {error.message}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Card>
          <CardContent className="pt-6 space-y-4">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!method) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p>Método não encontrado</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/methods' })}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
          Voltar
        </Button>

        {method.status === 'DRAFT' && (
          <Button
            render={<Link to="/dashboard/methods/$id/edit" params={{ id }} />}
          >
            <HugeiconsIcon icon={Edit02Icon} className="mr-2 h-4 w-4" />
            Editar
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">{method.name}</CardTitle>
              <CardDescription>
                {method.description || 'Sem descrição'}
              </CardDescription>
            </div>
            <div className="text-right">
              <Badge variant={statusVariants[method.status]}>
                {statusLabels[method.status]}
              </Badge>
              <p className="text-sm text-muted-foreground mt-1">
                Versão {method.version}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Tipo de Instrumento
              </p>
              <p>{method.assetTypeName || '-'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Criado por
              </p>
              <p>{method.createdByName || '-'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Criado em
              </p>
              <p>
                {new Date(method.createdAt).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            {method.publishedAt && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Publicado em
                </p>
                <p>
                  {new Date(method.publishedAt).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            )}
          </div>

          {/* Data Fields */}
          <div>
            <h3 className="font-semibold mb-2">
              Campos de Entrada ({method.dataFields.length})
            </h3>
            {method.dataFields.length === 0 ? (
              <p className="text-muted-foreground">
                Nenhum campo de entrada definido
              </p>
            ) : (
              <div className="grid gap-2">
                {method.dataFields.map((field) => (
                  <div
                    key={field.key}
                    className="p-2 border rounded bg-muted/30"
                  >
                    <span className="font-medium">{field.label}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      ({field.key}: {field.type}
                      {field.unit && ` [${field.unit}]`})
                    </span>
                    {field.required && (
                      <span className="text-xs text-red-500 ml-1">*</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Formulas */}
          <div>
            <h3 className="font-semibold mb-2">
              Fórmulas ({method.formulas.length})
            </h3>
            {method.formulas.length === 0 ? (
              <p className="text-muted-foreground">Nenhuma fórmula definida</p>
            ) : (
              <div className="grid gap-2">
                {method.formulas.map((formula) => (
                  <div
                    key={formula.outputKey}
                    className="p-2 border rounded bg-muted/30"
                  >
                    <span className="font-medium">
                      {formula.label || formula.outputKey}
                    </span>
                    <code className="text-xs bg-muted px-1 rounded ml-2">
                      {formula.expression}
                    </code>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Validations */}
          <div>
            <h3 className="font-semibold mb-2">
              Critérios de Aceitação ({method.validations.length})
            </h3>
            {method.validations.length === 0 ? (
              <p className="text-muted-foreground">Nenhum critério definido</p>
            ) : (
              <div className="grid gap-2">
                {method.validations.map((validation, idx) => (
                  <div key={idx} className="p-2 border rounded bg-muted/30">
                    <span
                      className={`text-xs px-1 rounded ${validation.severity === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}
                    >
                      {validation.severity === 'error' ? 'Erro' : 'Aviso'}
                    </span>
                    <code className="text-xs bg-muted px-1 rounded ml-2">
                      {validation.expression}
                    </code>
                    <p className="text-sm text-muted-foreground mt-1">
                      {validation.message}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
