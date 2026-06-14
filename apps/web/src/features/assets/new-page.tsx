import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { parseAsInteger, useQueryState } from 'nuqs'

import { AssetCreateForm } from '@/features/assets/components/asset-create-form'

export function NewAssetPage() {
  const navigate = useNavigate()

  // Read customerId from query params (e.g., /dashboard/assets/new?customerId=123)
  const [customerIdParam] = useQueryState('customerId', parseAsInteger)

  return (
    <div className="space-y-6">
      <div className="min-w-0 space-y-1">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Cadastro de ativo
        </p>
        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          Novo ativo
        </h1>
        <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
          Vincule o instrumento ao cliente, identifique-o e registre as
          especificações necessárias para calibração.
        </p>
      </div>

      <AssetCreateForm
        defaultCustomerId={customerIdParam ?? null}
        onSaved={() => {
          toast.success('Ativo criado com sucesso!')
          navigate({ to: '/dashboard/assets' })
        }}
        onCancel={() => navigate({ to: '/dashboard/assets' })}
      />
    </div>
  )
}
