import { createFileRoute } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import {
  CloudUploadIcon,
  Delete02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { useSettings } from '@/contexts/settings-context'
import { resolveApiURL } from '@/utils/api'
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

export const Route = createFileRoute('/dashboard/settings/profile')({
  head: () => ({
    meta: [{ title: 'Perfil | Configurações | CalibraFácil' }],
  }),
  component: ProfileSettingsPage,
})

function ProfileSettingsPage() {
  const { user, isLoading, isUpdating, updateProfile, clearError } =
    useSettings()

  if (isLoading) {
    return <ProfileSkeleton />
  }

  if (!user) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Usuário não encontrado
        </CardContent>
      </Card>
    )
  }

  return (
    <ProfileSettingsForm
      key={user.id}
      user={user}
      isUpdating={isUpdating}
      updateProfile={updateProfile}
      clearError={clearError}
    />
  )
}

function ProfileSettingsForm({
  user,
  isUpdating,
  updateProfile,
  clearError,
}: {
  user: NonNullable<ReturnType<typeof useSettings>['user']>
  isUpdating: boolean
  updateProfile: ReturnType<typeof useSettings>['updateProfile']
  clearError: ReturnType<typeof useSettings>['clearError']
}) {
  const [name, setName] = useState(user.name ?? '')
  const [formError, setFormError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('avatar', file)

      const res = await fetch(`${resolveApiURL()}/api/profile-media/avatar`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao enviar avatar',
        )
      }

      return res.json() as Promise<{ imageUrl: string }>
    },
    onSuccess: async (data) => {
      await updateProfile({ image: data.imageUrl })
      setPreviewUrl(null)
      toast.success('Avatar atualizado')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Falha ao enviar avatar')
    },
  })

  const deleteAvatarMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${resolveApiURL()}/api/profile-media/avatar`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao remover avatar',
        )
      }
    },
    onSuccess: async () => {
      await updateProfile({ image: '' })
      setPreviewUrl(null)
      toast.success('Avatar removido')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao remover avatar',
      )
    },
  })

  const handleAvatarSelect = (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('Use PNG, JPG ou WebP')
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 2MB.')
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      setPreviewUrl((event.target?.result as string) ?? null)
    }
    reader.readAsDataURL(file)
    uploadMutation.mutate(file)
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
                <div className="flex flex-col gap-4 rounded-xl border p-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-5">
                    <Avatar className="size-20 sm:size-24">
                      <AvatarImage
                        src={previewUrl || user.image || ''}
                        alt={user.name ?? ''}
                      />
                      <AvatarFallback className="text-xl sm:text-2xl">
                        {getInitials(user.name ?? 'U')}
                      </AvatarFallback>
                    </Avatar>

                    <div className="space-y-2">
                      <p className="font-medium">Avatar do perfil</p>
                      <p className="max-w-md text-sm text-muted-foreground">
                        Sua foto aparece na navegação do dashboard e do portal.
                        O asset fica em storage privado e é servido pela API.
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {user.image ? (
                          <>
                            <HugeiconsIcon icon={Tick02Icon} className="size-4" />
                            Avatar configurado
                          </>
                        ) : (
                          'Nenhum avatar configurado'
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) {
                          handleAvatarSelect(file)
                        }
                        event.currentTarget.value = ''
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isUpdating || uploadMutation.isPending}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <HugeiconsIcon icon={CloudUploadIcon} className="size-4" />
                      {user.image ? 'Trocar avatar' : 'Enviar avatar'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        isUpdating ||
                        deleteAvatarMutation.isPending ||
                        (!user.image && !previewUrl)
                      }
                      onClick={() => deleteAvatarMutation.mutate()}
                    >
                      <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                      Remover
                    </Button>
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
                  disabled={
                    isUpdating ||
                    uploadMutation.isPending ||
                    deleteAvatarMutation.isPending
                  }
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
                <Button
                  type="submit"
                  disabled={
                    isUpdating ||
                    uploadMutation.isPending ||
                    deleteAvatarMutation.isPending
                  }
                >
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
