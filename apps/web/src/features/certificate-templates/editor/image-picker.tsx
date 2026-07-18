import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Editor } from '@tiptap/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Image01Icon } from '@hugeicons/core-free-icons'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { calibraApi } from '@/utils/api'

/**
 * Org media picker (roadmap item 3): browse/upload library images and insert
 * them as TYPED image nodes ({mediaId}) — never a raw URL (tenant isolation +
 * determinism; the worker resolves ids to data URLs at compile time).
 */
export function ImagePicker({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const queryClient = useQueryClient()

  const libraryQuery = useQuery({
    queryKey: ['organization-media', 'library'],
    queryFn: () => calibraApi.organizationMedia.listLibrary(),
    enabled: open,
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      calibraApi.organizationMedia.uploadLibrary(file, { fileName: file.name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['organization-media', 'library'],
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao enviar imagem',
      )
    },
  })

  const insert = (mediaId: number, fileName: string) => {
    if (!editor) return
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'image',
        attrs: { mediaId, alt: fileName, widthMm: 60 },
      })
      .run()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Inserir imagem"
            title="Inserir imagem da biblioteca da organização"
            className="size-8 p-0 transition-[scale,background-color] active:scale-[0.96]"
          >
            <HugeiconsIcon icon={Image01Icon} size={16} strokeWidth={1.8} />
          </Button>
        }
      />
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-80 p-3"
        data-testid="image-picker"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Imagens da organização</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={uploadMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadMutation.isPending ? 'Enviando…' : 'Enviar'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            aria-label="Enviar imagem"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) uploadMutation.mutate(file)
              event.target.value = ''
            }}
          />
        </div>
        <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
          {(libraryQuery.data?.items ?? []).map((item) => (
            <button
              key={item.id}
              type="button"
              className="group flex flex-col gap-1 rounded-sm border p-1.5 text-left transition-[scale,border-color] hover:border-foreground/30 active:scale-[0.97]"
              onClick={() => insert(item.id, item.fileName)}
              title={item.fileName}
            >
              <img
                src={`/api/organization-media/library/${item.id}/file`}
                alt={item.fileName}
                className="h-16 w-full rounded object-contain outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                loading="lazy"
              />
              <span className="truncate text-[10px] text-muted-foreground">
                {item.fileName}
              </span>
            </button>
          ))}
          {libraryQuery.data?.items.length === 0 && (
            <p className="col-span-3 text-xs text-muted-foreground">
              Nenhuma imagem — envie a primeira.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
