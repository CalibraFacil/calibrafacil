import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CloudUploadIcon,
  Delete02Icon,
  Tick02Icon,
  Image02Icon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { api } from '@/utils/api'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/dashboard/settings/signature')({
  head: () => ({
    meta: [{ title: 'Assinatura | Configurações | CalibraFácil' }],
  }),
  component: SignatureSettingsPage,
})

function SignatureSettingsPage() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Fetch current signature
  const { data: signatureData, isLoading } = useQuery({
    queryKey: ['my-signature'],
    queryFn: async () => {
      const res = await api.api.signatures['my-signature'].$get()
      if (!res.ok) throw new Error('Failed to fetch signature')
      return res.json()
    },
  })

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('signature', file)

      const res = await api.api.signatures['my-signature'].$post({
        body: formData as unknown as { signature: File },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error((error as { error?: string }).error || 'Upload failed')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-signature'] })
      setPreviewUrl(null)
      toast.success('Assinatura salva com sucesso!')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.signatures['my-signature'].$delete()
      if (!res.ok) throw new Error('Failed to delete signature')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-signature'] })
      toast.success('Assinatura removida')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Handle file selection
  const handleFileSelect = useCallback(
    (file: File) => {
      // Validate file type
      if (file.type !== 'image/png') {
        toast.error('Apenas arquivos PNG são permitidos')
        return
      }

      // Validate file size (500KB)
      if (file.size > 500 * 1024) {
        toast.error('Arquivo muito grande. Máximo 500KB.')
        return
      }

      // Create preview
      const reader = new FileReader()
      reader.onload = (e) => {
        setPreviewUrl(e.target?.result as string)
      }
      reader.readAsDataURL(file)

      // Upload
      uploadMutation.mutate(file)
    },
    [uploadMutation]
  )

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)

      const file = e.dataTransfer.files[0]
      if (file) {
        handleFileSelect(file)
      }
    },
    [handleFileSelect]
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        handleFileSelect(file)
      }
    },
    [handleFileSelect]
  )

  // Clear preview URL on successful data fetch
  useEffect(() => {
    if (signatureData?.hasSignature && signatureData.url) {
      setPreviewUrl(null)
    }
  }, [signatureData])

  if (isLoading) {
    return <SignatureSkeleton />
  }

  const hasSignature = signatureData?.hasSignature
  const signatureUrl = previewUrl || (hasSignature ? signatureData?.url : null)
  const isUploading = uploadMutation.isPending
  const isDeleting = deleteMutation.isPending

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Assinatura Digital</CardTitle>
          <CardDescription>
            Sua assinatura será exibida nos certificados de calibração que você
            aprovar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Signature preview/upload area */}
          <div
            className={cn(
              'relative overflow-hidden rounded-xl border-2 border-dashed transition-all duration-300',
              'bg-gradient-to-br from-muted/30 via-background to-muted/50',
              isDragOver && 'border-primary bg-primary/5 scale-[1.01]',
              !isDragOver && !signatureUrl && 'border-muted-foreground/25',
              signatureUrl && 'border-primary/50',
              isUploading && 'opacity-70 pointer-events-none'
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* Decorative corner accents */}
            <div className="absolute top-0 left-0 w-8 h-8 border-l-2 border-t-2 border-muted-foreground/20 rounded-tl-lg" />
            <div className="absolute top-0 right-0 w-8 h-8 border-r-2 border-t-2 border-muted-foreground/20 rounded-tr-lg" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-l-2 border-b-2 border-muted-foreground/20 rounded-bl-lg" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-r-2 border-b-2 border-muted-foreground/20 rounded-br-lg" />

            {/* Paper texture lines */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
              {[...Array(12)].map((_, i) => (
                <div
                  key={i}
                  className="h-px bg-foreground"
                  style={{ marginTop: `${(i + 1) * 20}px` }}
                />
              ))}
            </div>

            {signatureUrl ? (
              /* Signature preview */
              <div className="flex flex-col items-center justify-center p-8 min-h-[240px]">
                <div className="relative group">
                  {/* Signature image with elegant frame */}
                  <div className="relative p-4 bg-white dark:bg-white/5 rounded-lg shadow-sm ring-1 ring-black/5 dark:ring-white/10">
                    <img
                      src={signatureUrl}
                      alt="Sua assinatura"
                      className="max-h-32 max-w-[280px] object-contain"
                    />
                  </div>

                  {/* Success indicator */}
                  {hasSignature && !previewUrl && (
                    <div className="absolute -top-2 -right-2 size-6 bg-green-500 rounded-full flex items-center justify-center shadow-lg">
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        className="size-3.5 text-white"
                      />
                    </div>
                  )}
                </div>

                <p className="mt-4 text-sm text-muted-foreground">
                  {isUploading ? 'Salvando...' : 'Assinatura atual'}
                </p>
              </div>
            ) : (
              /* Upload prompt */
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center w-full p-8 min-h-[240px] cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-xl"
                disabled={isUploading}
              >
                <div
                  className={cn(
                    'size-16 rounded-2xl flex items-center justify-center mb-4 transition-all duration-300',
                    'bg-muted group-hover:bg-primary/10 group-hover:scale-110',
                    isDragOver && 'bg-primary/20 scale-110'
                  )}
                >
                  <HugeiconsIcon
                    icon={isDragOver ? Image02Icon : CloudUploadIcon}
                    className={cn(
                      'size-8 transition-colors',
                      'text-muted-foreground group-hover:text-primary',
                      isDragOver && 'text-primary'
                    )}
                  />
                </div>

                <p className="text-base font-medium text-foreground">
                  {isDragOver
                    ? 'Solte o arquivo aqui'
                    : 'Arraste sua assinatura ou clique para selecionar'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  PNG transparente, máximo 500KB
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground/70">
                  Recomendado: 400x150 pixels
                </p>
              </button>
            )}

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png"
              onChange={handleInputChange}
              className="hidden"
              disabled={isUploading}
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            {/* Info box */}
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <HugeiconsIcon
                icon={InformationCircleIcon}
                className="size-4 mt-0.5 shrink-0"
              />
              <p>
                Use uma imagem PNG com fundo transparente para melhor resultado
                nos certificados.
              </p>
            </div>

            {/* Buttons */}
            <div className="flex gap-2 shrink-0">
              {hasSignature && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deleteMutation.mutate()}
                  disabled={isDeleting || isUploading}
                >
                  <HugeiconsIcon icon={Delete02Icon} className="size-4 mr-1.5" />
                  {isDeleting ? 'Removendo...' : 'Remover'}
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                <HugeiconsIcon
                  icon={CloudUploadIcon}
                  className="size-4 mr-1.5"
                />
                {isUploading
                  ? 'Enviando...'
                  : hasSignature
                    ? 'Alterar'
                    : 'Enviar assinatura'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tips card */}
      <Card size="sm">
        <CardHeader>
          <CardTitle>Dicas para uma boa assinatura digital</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
            <li className="flex items-start gap-2">
              <span className="size-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
                1
              </span>
              <span>
                Assine em papel branco com caneta preta ou azul escura
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="size-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
                2
              </span>
              <span>Digitalize ou fotografe com boa iluminação</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="size-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
                3
              </span>
              <span>Remova o fundo usando um editor de imagens</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="size-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
                4
              </span>
              <span>Salve como PNG para preservar a transparência</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function SignatureSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-64 mt-1" />
        </CardHeader>
        <CardContent className="space-y-6">
          <Skeleton className="h-60 w-full rounded-xl" />
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-9 w-32" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
