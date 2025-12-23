import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useSettings } from '@/contexts/settings-context'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Label } from '@/components/ui/label'

export const Route = createFileRoute('/dashboard/settings/profile')({
  head: () => ({
    meta: [{ title: 'Perfil | Configurações | CalibraFácil' }],
  }),
  component: ProfileSettingsPage,
})

function ProfileSettingsPage() {
  const { user, isLoading, isUpdating, updateProfile, clearError } =
    useSettings()

  const [name, setName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (user?.name) {
      setName(user.name)
    }
  }, [user?.name])

  if (isLoading) {
    return <ProfileSkeleton />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    clearError()

    if (!name.trim()) {
      setFormError('Nome é obrigatório')
      return
    }

    try {
      await updateProfile({ name: name.trim() })
      toast.success('Perfil atualizado com sucesso!')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao atualizar perfil'
      toast.error(message)
    }
  }

  const getInitials = (name: string) =>
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase()

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Perfil</CardTitle>
          <CardDescription>Gerencie seu perfil de usuário.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <div className="flex flex-row items-center gap-6">
                  {/* Left Column: Avatar */}
                  <Avatar className="size-20 sm:size-24">
                    <AvatarImage
                      src={user?.image ?? ''}
                      alt={user?.name ?? ''}
                    />
                    <AvatarFallback className="text-xl sm:text-2xl">
                      {getInitials(user?.name ?? 'U')}
                    </AvatarFallback>
                  </Avatar>

                  {/* Right Column: Label, Input, and Description */}
                  <div className="flex flex-col gap-2 w-full max-w-sm">
                    <Label htmlFor="avatar-upload">Alterar foto</Label>
                    <Input
                      id="avatar-upload"
                      type="file"
                      accept="image/*"
                      disabled={isUpdating}
                      className="cursor-pointer"
                    />
                    <span className="text-sm text-muted-foreground">
                      Sua foto de perfil será exibida em toda a plataforma.
                    </span>
                  </div>
                </div>
              </Field>

              {/* Name Field */}
              <Field>
                <FieldLabel htmlFor="name">Nome</FieldLabel>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setFormError(null)
                  }}
                  disabled={isUpdating}
                  placeholder="Seu nome completo"
                />
                {formError && <FieldError>{formError}</FieldError>}
              </Field>

              {/* Email Field (read-only) */}
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  value={user?.email ?? ''}
                  disabled
                  className="bg-muted cursor-not-allowed"
                />
                <FieldDescription>
                  O email não pode ser alterado diretamente. Entre em contato
                  com o suporte se precisar alterar.
                </FieldDescription>
              </Field>

              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={isUpdating}>
                  {isUpdating ? 'Salvando...' : 'Salvar alterações'}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-4 w-48 mt-2" />
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-6">
          <Skeleton className="size-20 rounded-full" />
          <div className="space-y-2 w-full max-w-sm">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>

        <div className="space-y-2">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-9 w-32" />
        </div>
      </CardContent>
    </Card>
  )
}
