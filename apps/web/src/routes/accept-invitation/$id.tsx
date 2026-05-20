import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { authClient, useSession } from '@calibra-facil/auth/client'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/accept-invitation/$id')({
  head: () => ({
    meta: [
      {
        title: 'Convite para Organização | CalibraFácil',
        name: 'description',
        content: 'Aceitar convite para participar de uma organização',
      },
    ],
  }),
  component: AcceptInvitationPage,
})

type InvitationData = {
  id: string
  email: string
  role: string
  status: string
  expiresAt: Date
  organizationId: string
  organizationName: string
  organizationSlug: string
  inviterEmail: string
}

function AcceptInvitationPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const { data: session, isPending: isSessionLoading } = useSession()
  const [isAccepting, setIsAccepting] = useState(false)
  const [isRejecting, setIsRejecting] = useState(false)
  const invitationQuery = useQuery({
    queryKey: ['accept-invitation', id],
    queryFn: async (): Promise<InvitationData> => {
      const { data, error } = await authClient.organization.getInvitation({
        query: { id },
      })

      if (error) {
        throw new Error(error.message || 'Não foi possível carregar o convite.')
      }

      return data as InvitationData
    },
  })
  const invitation = invitationQuery.data
  const error =
    invitationQuery.error instanceof Error
      ? invitationQuery.error.message
      : null

  async function handleAccept() {
    setIsAccepting(true)
    const { error } = await authClient.organization.acceptInvitation({
      invitationId: id,
    })

    if (error) {
      toast.error(error.message || 'Erro ao aceitar o convite.')
      setIsAccepting(false)
      return
    }

    toast.success('Convite aceito com sucesso!')
    navigate({ to: '/dashboard' })
  }

  async function handleReject() {
    setIsRejecting(true)
    const { error } = await authClient.organization.rejectInvitation({
      invitationId: id,
    })

    if (error) {
      toast.error(error.message || 'Erro ao rejeitar o convite.')
      setIsRejecting(false)
      return
    }

    toast.success('Convite rejeitado.')
    navigate({ to: '/' })
  }

  const roleLabels: Record<string, string> = {
    owner: 'Proprietário',
    admin: 'Administrador',
    operator: 'Operador',
    technician: 'Técnico',
    member: 'Membro',
  }

  if (isSessionLoading || invitationQuery.isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Carregando...</CardTitle>
            <CardDescription>
              Verificando informações do convite
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Convite Inválido</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Link to="/" className={cn(buttonVariants(), 'w-full')}>
              Voltar para o início
            </Link>
          </CardFooter>
        </Card>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Convite para Organização</CardTitle>
            <CardDescription>
              Você foi convidado para participar de{' '}
              <strong>{invitation?.organizationName}</strong>. Faça login ou
              crie uma conta para aceitar o convite.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {invitation && (
              <div className="rounded-lg border p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Organização:</span>
                  <span className="font-medium">
                    {invitation.organizationName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Função:</span>
                  <span className="font-medium">
                    {roleLabels[invitation.role] || invitation.role}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Convidado por:</span>
                  <span className="font-medium">{invitation.inviterEmail}</span>
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex gap-2">
            <Link
              to="/sign-in"
              search={{ redirect: `/accept-invitation/${id}` }}
              className={cn(buttonVariants(), 'flex-1')}
            >
              Entrar
            </Link>
            <Link
              to="/sign-up"
              search={{ redirect: `/accept-invitation/${id}` }}
              className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}
            >
              Criar conta
            </Link>
          </CardFooter>
        </Card>
      </div>
    )
  }

  if (invitation?.status !== 'pending') {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Convite Já Utilizado</CardTitle>
            <CardDescription>
              Este convite já foi{' '}
              {invitation?.status === 'accepted' ? 'aceito' : 'rejeitado'}.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Link to="/dashboard" className={cn(buttonVariants(), 'w-full')}>
              Ir para o Dashboard
            </Link>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Convite para Organização</CardTitle>
          <CardDescription>
            Você foi convidado para participar de uma organização no
            CalibraFácil.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {invitation && (
            <div className="rounded-lg border p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Organização:</span>
                <span className="font-medium">
                  {invitation.organizationName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Função:</span>
                <span className="font-medium">
                  {roleLabels[invitation.role] || invitation.role}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Convidado por:</span>
                <span className="font-medium">{invitation.inviterEmail}</span>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button
            onClick={handleAccept}
            disabled={isAccepting || isRejecting}
            className="flex-1"
          >
            {isAccepting ? 'Aceitando...' : 'Aceitar'}
          </Button>
          <Button
            onClick={handleReject}
            disabled={isAccepting || isRejecting}
            variant="outline"
            className="flex-1"
          >
            {isRejecting ? 'Rejeitando...' : 'Rejeitar'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
