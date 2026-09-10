import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  Delete02Icon,
  Edit02Icon,
  PlusSignIcon,
  RulerIcon,
} from '@hugeicons/core-free-icons'
import { toast } from 'sonner'
import { MassCompositionProfileCreateSchema } from '@calibra-facil/schemas'
import type {
  MassCompositionProfileDto,
  MassCompositionProfileWriteInput,
} from '@calibra-facil/client-runtime'

import {
  useCompositionProfilesCatalog,
  useCreateCompositionProfile,
  useDeleteCompositionProfile,
  useUpdateCompositionProfile,
} from '@/features/standards/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'

/** Trim float artifacts (0.919999999998 → 0.92) without losing real precision. */
function fmtNum(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value === 0) return '0'
  return String(Number.parseFloat(value.toPrecision(9)))
}

function numToStr(value: number | null | undefined): string {
  return value == null ? '' : String(value)
}

function emptyToNull(value: string): string | null {
  return value.trim() === '' ? null : value
}

function groupByClass(
  profiles: readonly MassCompositionProfileDto[],
): Array<{ profileClass: string; rows: MassCompositionProfileDto[] }> {
  const map = new Map<string, MassCompositionProfileDto[]>()
  for (const profile of profiles) {
    const list = map.get(profile.profileClass)
    if (list) list.push(profile)
    else map.set(profile.profileClass, [profile])
  }
  return [...map.entries()]
    .map(([profileClass, rows]) => ({
      profileClass,
      rows: [...rows].sort((a, b) => a.nominalG - b.nominalG),
    }))
    .sort((a, b) => a.profileClass.localeCompare(b.profileClass))
}

type DialogState =
  | { mode: 'new' }
  | { mode: 'edit'; profile: MassCompositionProfileDto }
  | null

export function StandardsCompositionProfilesPage() {
  const { data, isLoading, error } = useCompositionProfilesCatalog()
  const [dialog, setDialog] = useState<DialogState>(null)
  const [deleting, setDeleting] = useState<MassCompositionProfileDto | null>(
    null,
  )

  const profiles = data?.data ?? []
  const groups = groupByClass(profiles)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Catálogo · Metrologia
          </p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            Perfis de composição
          </h1>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Pesos padrão por classe (M1, F1, M2…) usados para compor a massa de
            referência durante a calibração.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            render={<Link to="/dashboard/standards" />}
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
            Padrões
          </Button>
          <Button
            onClick={() => setDialog({ mode: 'new' })}
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
            Novo perfil
          </Button>
        </div>
      </div>

      {error ? (
        <Panel className="p-8 text-center">
          <p className="text-sm text-destructive">
            Erro ao carregar o catálogo: {error.message}
          </p>
        </Panel>
      ) : isLoading ? (
        <CatalogSkeleton />
      ) : profiles.length === 0 ? (
        <Panel className="p-4 sm:p-5">
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={RulerIcon} />
              </EmptyMedia>
              <EmptyTitle>Catálogo vazio</EmptyTitle>
              <EmptyDescription>
                Nenhum perfil de composição cadastrado. Use “Novo perfil” para
                adicionar o primeiro.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Panel>
      ) : (
        <>
          <StaggerGroup className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
            <StaggerItem>
              <SignalTile
                icon={RulerIcon}
                label="Perfis cadastrados"
                value={String(profiles.length)}
                hint="no catálogo"
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={RulerIcon}
                label="Classes"
                value={String(groups.length)}
                hint={groups.map((g) => g.profileClass).join(' · ')}
                tone="neutral"
              />
            </StaggerItem>
          </StaggerGroup>

          {groups.map((group) => (
            <Panel key={group.profileClass} className="p-4 sm:p-5">
              <PanelHeader
                title={`Perfis ${group.profileClass}`}
                description={`${group.rows.length} ${
                  group.rows.length === 1 ? 'perfil' : 'perfis'
                } de composição.`}
              />
              <div className="mt-4">
                <ProfileTable
                  rows={group.rows}
                  onEdit={(profile) => setDialog({ mode: 'edit', profile })}
                  onDelete={(profile) => setDeleting(profile)}
                />
              </div>
            </Panel>
          ))}
        </>
      )}

      {dialog ? (
        <ProfileFormDialog
          key={dialog.mode === 'edit' ? dialog.profile.id : 'new'}
          state={dialog}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {deleting ? (
        <DeleteProfileDialog
          profile={deleting}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </div>
  )
}

function ProfileTable({
  rows,
  onEdit,
  onDelete,
}: {
  rows: MassCompositionProfileDto[]
  onEdit: (profile: MassCompositionProfileDto) => void
  onDelete: (profile: MassCompositionProfileDto) => void
}) {
  return (
    <div className="overflow-x-auto rounded-xl bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
      <table className="w-full min-w-[56rem] text-sm">
        <thead>
          <tr className="border-b border-border/70 bg-muted/40">
            <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
              Perfil
            </th>
            <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
              Classe
            </th>
            <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
              Valor
            </th>
            <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
              Incerteza (U)
            </th>
            <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
              Unidade
            </th>
            <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
              Erro máximo
            </th>
            <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
              Deriva
            </th>
            <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
              Empuxo
            </th>
            <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
              k
            </th>
            <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
              Qtd.
            </th>
            <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
              Ações
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((profile) => (
            <tr
              key={profile.id}
              className="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/35"
            >
              <td className="px-3 py-2.5 font-mono tabular-nums">
                {profile.profileKey}
              </td>
              <td className="px-3 py-2.5">
                <Badge variant="secondary">{profile.profileClass}</Badge>
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                {fmtNum(profile.value)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                ±{fmtNum(profile.uncertainty)}
              </td>
              <td className="px-3 py-2.5">{profile.unit}</td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                {fmtNum(profile.maxError)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                {fmtNum(profile.drift)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                {fmtNum(profile.buoyancy)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                {fmtNum(profile.coverageFactor)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                {profile.quantityAvailable ?? '—'}
              </td>
              <td className="px-3 py-2.5">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Editar ${profile.profileKey}`}
                    onClick={() => onEdit(profile)}
                  >
                    <HugeiconsIcon icon={Edit02Icon} className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover ${profile.profileKey}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(profile)}
                  >
                    <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type ProfileFormState = {
  profileClass: string
  profileKey: string
  nominal: string
  nominalG: string
  unit: string
  value: string
  uncertainty: string
  maxError: string
  drift: string
  buoyancy: string
  coverageFactor: string
  quantityAvailable: string
}

function initialFormState(
  profile: MassCompositionProfileDto | null,
): ProfileFormState {
  return {
    profileClass: profile?.profileClass ?? '',
    profileKey: profile?.profileKey ?? '',
    nominal: profile?.nominal ?? '',
    nominalG: numToStr(profile?.nominalG),
    unit: profile?.unit ?? 'g',
    value: numToStr(profile?.value),
    uncertainty: numToStr(profile?.uncertainty),
    maxError: numToStr(profile?.maxError),
    drift: numToStr(profile?.drift),
    buoyancy: numToStr(profile?.buoyancy),
    coverageFactor: numToStr(profile?.coverageFactor),
    quantityAvailable: numToStr(profile?.quantityAvailable),
  }
}

function toWriteInput(form: ProfileFormState): Record<string, unknown> {
  return {
    profileClass: form.profileClass.trim(),
    profileKey: form.profileKey.trim(),
    nominal: form.nominal.trim(),
    nominalG: form.nominalG,
    unit: form.unit.trim() || 'g',
    value: form.value,
    uncertainty: form.uncertainty,
    maxError: emptyToNull(form.maxError),
    drift: emptyToNull(form.drift),
    buoyancy: emptyToNull(form.buoyancy),
    coverageFactor: emptyToNull(form.coverageFactor),
    quantityAvailable: emptyToNull(form.quantityAvailable),
  }
}

function ProfileFormDialog({
  state,
  onClose,
}: {
  state: { mode: 'new' } | { mode: 'edit'; profile: MassCompositionProfileDto }
  onClose: () => void
}) {
  const isEdit = state.mode === 'edit'
  const [form, setForm] = useState<ProfileFormState>(
    initialFormState(isEdit ? state.profile : null),
  )
  const [formError, setFormError] = useState<string | null>(null)
  const createMutation = useCreateCompositionProfile()
  const updateMutation = useUpdateCompositionProfile()
  const isPending = createMutation.isPending || updateMutation.isPending

  const set =
    (field: keyof ProfileFormState) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: event.target.value }))

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)

    const parsed = MassCompositionProfileCreateSchema.safeParse(
      toWriteInput(form),
    )
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ?? 'Verifique os campos do perfil.',
      )
      return
    }
    const input: MassCompositionProfileWriteInput = parsed.data

    const onSuccess = () => {
      toast.success(isEdit ? 'Perfil atualizado' : 'Perfil criado')
      onClose()
    }

    if (isEdit) {
      updateMutation.mutate(
        { id: state.profile.id, input },
        { onSuccess, onError: (error) => toast.error(error.message) },
      )
    } else {
      createMutation.mutate(input, {
        onSuccess,
        onError: (error) => toast.error(error.message),
      })
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? 'Editar perfil de composição'
              : 'Novo perfil de composição'}
          </DialogTitle>
          <DialogDescription>
            Valores em gramas (unidade canônica). Cada perfil é único por classe
            e nominal.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Classe" required>
              <Input
                value={form.profileClass}
                onChange={set('profileClass')}
                placeholder="M1"
                required
              />
            </Field>
            <Field label="Perfil (identificador)" required>
              <Input
                value={form.profileKey}
                onChange={set('profileKey')}
                placeholder="20kg-M1"
                required
              />
            </Field>
            <Field label="Nominal (descrição)" required>
              <Input
                value={form.nominal}
                onChange={set('nominal')}
                placeholder="20 kg"
                required
              />
            </Field>
            <Field label="Nominal em gramas" required>
              <Input
                type="number"
                step="any"
                inputMode="decimal"
                value={form.nominalG}
                onChange={set('nominalG')}
                placeholder="20000"
                required
              />
            </Field>
            <Field label="Valor (g)" required>
              <Input
                type="number"
                step="any"
                inputMode="decimal"
                value={form.value}
                onChange={set('value')}
                required
              />
            </Field>
            <Field label="Incerteza U (g)" required>
              <Input
                type="number"
                step="any"
                inputMode="decimal"
                value={form.uncertainty}
                onChange={set('uncertainty')}
                required
              />
            </Field>
            <Field label="Erro máximo (g)">
              <Input
                type="number"
                step="any"
                inputMode="decimal"
                value={form.maxError}
                onChange={set('maxError')}
              />
            </Field>
            <Field label="Deriva (g)">
              <Input
                type="number"
                step="any"
                inputMode="decimal"
                value={form.drift}
                onChange={set('drift')}
              />
            </Field>
            <Field label="Empuxo (g)">
              <Input
                type="number"
                step="any"
                inputMode="decimal"
                value={form.buoyancy}
                onChange={set('buoyancy')}
              />
            </Field>
            <Field label="k (fator de cobertura)">
              <Input
                type="number"
                step="any"
                inputMode="decimal"
                value={form.coverageFactor}
                onChange={set('coverageFactor')}
              />
            </Field>
            <Field label="Qtd. disponível">
              <Input
                type="number"
                step="1"
                inputMode="numeric"
                value={form.quantityAvailable}
                onChange={set('quantityAvailable')}
              />
            </Field>
            <Field label="Unidade">
              <Input value={form.unit} onChange={set('unit')} placeholder="g" />
            </Field>
          </div>

          {formError ? (
            <p className="text-sm text-destructive">{formError}</p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar perfil'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}

function DeleteProfileDialog({
  profile,
  onClose,
}: {
  profile: MassCompositionProfileDto
  onClose: () => void
}) {
  const deleteMutation = useDeleteCompositionProfile()

  const handleDelete = () => {
    deleteMutation.mutate(profile.id, {
      onSuccess: () => {
        toast.success('Perfil removido')
        onClose()
      },
      onError: (mutationError) => toast.error(mutationError.message),
    })
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover perfil?</AlertDialogTitle>
          <AlertDialogDescription>
            O perfil <span className="font-mono">{profile.profileKey}</span> (
            {profile.profileClass}) deixará de aparecer no catálogo e nas
            montagens de composição. Esta ação pode ser refeita recriando o
            perfil.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending}>
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteMutation.isPending ? 'Removendo…' : 'Remover'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CatalogSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
        {Array.from({ length: 2 }).map((_item, index) => (
          <Skeleton key={index} className="h-[88px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  )
}
