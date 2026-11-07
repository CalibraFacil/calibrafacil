import {
  CustomerEditForm,
  type UpdatedCustomer,
} from '@/features/customers/components/customer-edit-form'
import { useCustomerDetailData } from '@/features/customers/queries'
import {
  AssetEditForm,
  type UpdatedAsset,
} from '@/features/assets/components/asset-edit-form'
import { useAssetDetailData } from '@/features/assets/queries'
import { Skeleton } from '@calibra-facil/ui/skeleton'
import { operation } from '@calibra-facil/client-runtime'
import { useAvailability } from '@/runtime/use-operation-availability'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import { useCustomerGroupsList } from '@/features/customer-groups/queries'

const SKELETON_ROWS = ['a', 'b', 'c', 'd']

function SheetFormSkeleton() {
  return (
    <div className="space-y-4">
      {SKELETON_ROWS.map((row) => (
        <div key={row} className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  )
}

const CUSTOMER_GROUPS_OPERATIONS = [
  operation('customerGroups', 'list'),
] as const

/**
 * Loads the full customer detail (+ groups) by its route slug and
 * renders the reusable edit form inside the Service Order sheet.
 */
export function CustomerEditSheetBody({
  customerSlug,
  onSaved,
  onCancel,
}: {
  customerSlug: string
  onSaved: (customer: UpdatedCustomer) => void
  onCancel: () => void
}) {
  const { data: customer, isLoading } = useCustomerDetailData(customerSlug)
  const { activeOrganizationId } = useDashboardContextState()
  // Customer groups are cloud-only: shown whenever the call can run.
  const hasCustomerGroups = useAvailability(CUSTOMER_GROUPS_OPERATIONS)
  const groupsQuery = useCustomerGroupsList(
    activeOrganizationId,
    hasCustomerGroups,
  )
  const groups = groupsQuery.data?.data ?? []

  if (isLoading || !customer) {
    return <SheetFormSkeleton />
  }

  return (
    <CustomerEditForm
      customer={customer}
      customerId={customerSlug}
      groups={groups}
      showGroupField={hasCustomerGroups}
      variant="sheet"
      onSaved={onSaved}
      onCancel={onCancel}
    />
  )
}

/**
 * Loads the full asset detail by its route slug and renders the reusable edit
 * form inside the Service Order sheet.
 */
export function AssetEditSheetBody({
  assetSlug,
  onSaved,
  onCancel,
}: {
  assetSlug: string
  onSaved: (asset: UpdatedAsset) => void
  onCancel: () => void
}) {
  const { data: asset, isLoading } = useAssetDetailData(assetSlug)

  if (isLoading || !asset) {
    return <SheetFormSkeleton />
  }

  return (
    <AssetEditForm
      asset={asset}
      assetId={assetSlug}
      variant="sheet"
      onSaved={onSaved}
      onCancel={onCancel}
    />
  )
}
