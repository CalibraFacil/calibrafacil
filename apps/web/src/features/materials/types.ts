import type {
  MaterialDetailData as ClientRuntimeMaterialDetailData,
  MaterialsListData as ClientRuntimeMaterialsListData,
} from '@calibra-facil/client-runtime'

export const MATERIALS_LIST_STATUSES = ['active', 'inactive'] as const

export type MaterialsListStatus = (typeof MATERIALS_LIST_STATUSES)[number]

export type MaterialListItem = ClientRuntimeMaterialsListData['data'][number]
export type MaterialDetail = ClientRuntimeMaterialDetailData

export type MaterialsListData = Omit<ClientRuntimeMaterialsListData, 'data'> & {
  data: MaterialListItem[]
}

export type MaterialsListQueryInput = {
  organizationId: string
  page: number
  limit: number
  search: string
  statusFilter: MaterialsListStatus | ''
}
