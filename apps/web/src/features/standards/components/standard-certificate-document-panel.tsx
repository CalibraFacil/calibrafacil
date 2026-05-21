import { useRef, useState, type ChangeEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CloudUploadIcon,
  Download04Icon,
  File01Icon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { calibraApi } from '@/utils/api'
import type { StandardDetail } from '@/features/standards/types'

function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function openSignedDownload(url: string, filename: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export function StandardCertificateDocumentPanel({
  standard,
}: {
  standard: StandardDetail
}) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const document = standard.certificateDocument

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      calibraApi.standards.uploadCertificateDocument(standard.id, file, {
        fileName: file.name,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['standards'] })
      setSelectedFileName(null)
      if (inputRef.current) inputRef.current.value = ''
      toast.success('Certificado do padrão enviado.')
    },
    onError: (error) => toast.error(error.message),
  })

  const downloadMutation = useMutation({
    mutationFn: () =>
      calibraApi.standards.getCertificateDocumentDownloadUrl(standard.id),
    onSuccess: ({ url, filename }) => openSignedDownload(url, filename),
    onError: (error) => toast.error(error.message),
  })

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setSelectedFileName(file.name)
    uploadMutation.mutate(file)
  }

  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-background shadow-xs ring-1 ring-border/70">
          <HugeiconsIcon icon={File01Icon} className="size-5 text-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-sm font-medium">Certificado original</h3>
              {document ? (
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {document.fileName} · {formatFileSize(document.fileSize)}
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  Nenhum PDF enviado para este padrão.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              {document && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => downloadMutation.mutate()}
                  disabled={downloadMutation.isPending}
                >
                  {downloadMutation.isPending ? (
                    <Spinner className="mr-2 size-4" />
                  ) : (
                    <HugeiconsIcon
                      icon={Download04Icon}
                      className="mr-2 size-4"
                    />
                  )}
                  Baixar
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={uploadMutation.isPending}
              >
                {uploadMutation.isPending ? (
                  <Spinner className="mr-2 size-4" />
                ) : (
                  <HugeiconsIcon
                    icon={CloudUploadIcon}
                    className="mr-2 size-4"
                  />
                )}
                {document ? 'Substituir PDF' : 'Enviar PDF'}
              </Button>
            </div>
          </div>
          {document && (
            <dl className="mt-4 grid gap-3 border-t border-border/70 pt-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Certificado</dt>
                <dd className="mt-1 font-mono tabular-nums">
                  {document.certificateNumber}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Validade</dt>
                <dd className="mt-1 font-mono tabular-nums">
                  {formatDate(document.calibrationDate)} -{' '}
                  {formatDate(document.nextCalibrationDate)}
                </dd>
              </div>
            </dl>
          )}
          {selectedFileName && uploadMutation.isPending && (
            <p className="mt-3 text-xs text-muted-foreground">
              Enviando {selectedFileName}
            </p>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  )
}
