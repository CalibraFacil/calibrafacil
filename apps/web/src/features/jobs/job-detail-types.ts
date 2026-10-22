import { useJobDetailData } from '@/features/jobs/queries'

export type JobDetailData = NonNullable<
  ReturnType<typeof useJobDetailData>['data']
>
