import { isDashboardCloudOnlyPath } from '@/app/router/route-meta'

export function isCloudOnlyDashboardPath(pathname: string) {
  return isDashboardCloudOnlyPath(pathname)
}
