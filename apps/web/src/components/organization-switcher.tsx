'use client'

import * as React from 'react'

import {
  Building02Icon,
  PlusSignIcon,
  UnfoldMoreIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import {
  organization,
  useActiveOrganization,
  useListOrganizations,
} from '@calibra-facil/auth/client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'

export function OrganizationSwitcher() {
  const { isMobile } = useSidebar()
  const { data: allOrganizations, isPending: isLoadingOrgs } =
    useListOrganizations()
  const { data: activeOrg } = useActiveOrganization()

  // Filter to only show LAB organizations in the dashboard switcher
  // The 'type' field is a direct column on organization table (not in metadata)
  const organizations = React.useMemo(() => {
    if (!allOrganizations) return []
    return allOrganizations.filter((org) => org.type !== 'CLIENT')
  }, [allOrganizations])

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [orgName, setOrgName] = React.useState('')
  const [orgSlug, setOrgSlug] = React.useState('')
  const [isCreating, setIsCreating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value
    setOrgName(name)
    setOrgSlug(generateSlug(name))
  }

  const handleCreateOrganization = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsCreating(true)

    const { error } = await organization.create({
      name: orgName,
      slug: orgSlug,
      // Explicitly set type to LAB for organizations created from dashboard
      type: 'LAB',
    })

    setIsCreating(false)

    if (error) {
      setError(error.message ?? 'Erro ao criar laboratório')
      return
    }

    setOrgName('')
    setOrgSlug('')
    setDialogOpen(false)
  }

  const handleSetActiveOrganization = async (orgId: string) => {
    await organization.setActive({ organizationId: orgId })
    // Store preference for dashboard to avoid conflicts with portal
    localStorage.setItem('dashboard-active-org', orgId)
  }

  if (isLoadingOrgs) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg">
            <Skeleton className="size-8 rounded-lg" />
            <div className="grid flex-1 gap-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                    <HugeiconsIcon icon={Building02Icon} className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">
                      {activeOrg?.name ?? 'Selecionar laboratório'}
                    </span>
                    <span className="truncate text-xs">
                      {activeOrg?.slug ?? 'Nenhum selecionado'}
                    </span>
                  </div>
                  <HugeiconsIcon icon={UnfoldMoreIcon} className="ml-auto" />
                </SidebarMenuButton>
              }
            />
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
              align="start"
              side={isMobile ? 'bottom' : 'right'}
              sideOffset={4}
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  Laboratórios
                </DropdownMenuLabel>
                {organizations && organizations.length > 0 ? (
                  organizations.map((org, index) => (
                    <DropdownMenuItem
                      key={org.id}
                      onClick={() => handleSetActiveOrganization(org.id)}
                      className="gap-2 p-2"
                    >
                      <div className="flex size-6 items-center justify-center rounded-md border">
                        <HugeiconsIcon
                          icon={Building02Icon}
                          className="size-3.5 shrink-0"
                        />
                      </div>
                      {org.name}
                      {index < 9 && (
                        <DropdownMenuShortcut>
                          ⌘{index + 1}
                        </DropdownMenuShortcut>
                      )}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    Nenhum laboratório encontrado
                  </div>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 p-2"
                onClick={() => setDialogOpen(true)}
              >
                <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                  <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
                </div>
                <div className="text-muted-foreground font-medium">
                  Adicionar laboratório
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar Laboratório</DialogTitle>
            <DialogDescription>
              Crie um novo laboratório para gerenciar suas calibrações e ativos.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateOrganization} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="org-name">Nome do Laboratório</Label>
              <Input
                id="org-name"
                value={orgName}
                onChange={handleNameChange}
                placeholder="Meu Laboratório"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="org-slug">Identificador (slug)</Label>
              <Input
                id="org-slug"
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                placeholder="Laboratório"
                required
              />
              <p className="text-xs text-muted-foreground">
                Usado na URL: app.calibrafacil.com/{orgSlug || 'slug'}
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isCreating}>
                {isCreating ? 'Criando...' : 'Criar Laboratório'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
