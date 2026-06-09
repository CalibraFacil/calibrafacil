import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, RulerIcon } from '@hugeicons/core-free-icons'
import type { MassCompositionProfileDto } from '@calibra-facil/client-runtime'

import { useCompositionProfilesCatalog } from '@/features/standards/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
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

export function StandardsCompositionProfilesPage() {
  const { data, isLoading, error } = useCompositionProfilesCatalog()
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
            Pesos padrão compartilhados, organizados por classe, usados para
            montar massas durante a calibração. Estes valores são a fonte única
            do laboratório — cada padrão de referência usa este catálogo em vez
            de manter cópias próprias.
          </p>
        </div>
        <Button
          variant="outline"
          render={<Link to="/dashboard/standards" />}
          className={`${ACTION_BUTTON_CLASS} shrink-0`}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
          Padrões
        </Button>
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
                Nenhum perfil de composição cadastrado para este laboratório.
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
                eyebrow="Classe"
                title={`Perfis ${group.profileClass}`}
                description={`${group.rows.length} ${
                  group.rows.length === 1 ? 'perfil' : 'perfis'
                } de composição.`}
              />
              <div className="mt-4">
                <ProfileTable rows={group.rows} />
              </div>
            </Panel>
          ))}
        </>
      )}
    </div>
  )
}

function ProfileTable({ rows }: { rows: MassCompositionProfileDto[] }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
      <table className="w-full min-w-[52rem] text-sm">
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
