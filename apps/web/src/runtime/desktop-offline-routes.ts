import {
  listCalibraApiPolicyEntries,
  type CalibraApiMethod,
  type CalibraApiNamespace,
} from '@calibra-facil/client-runtime'

import type { FileRouteTypes } from '@/routeTree.gen'

/**
 * Which dashboard routes work without the cloud on the desktop.
 *
 * Offline mode is deliberately narrow (audit decision Q13): field capture,
 * intake and reference reads. The data-policy registry in
 * `@calibra-facil/client-runtime` is the single source of truth for what the
 * desktop can do offline, so this module does not keep a second list of
 * "cloud-only" routes. Instead it keeps ONE allowlist of routes that render
 * from local data, and a route is available offline only if every client
 * method it needs to render is non-`cloud-only` in the registry. Reclassifying a
 * method in the registry therefore moves every route that needs it with it.
 *
 * A route that is not in the allowlist is cloud-only on the desktop. That is
 * the default for every new route, so adding a screen can never silently
 * promise offline support.
 *
 * `renders` lists the reads a route needs to show its primary content. It does
 * NOT gate the actions a page offers on top of that (approve, edit, issue a
 * document, ...). Each of those has to be gated by the page itself with
 * `useOperationAvailability` + `ActionAvailabilityGate`, which read the same
 * registry. Allowlisting a route therefore means auditing its actions: the
 * service-order detail page's quote, execution and delivery-document actions
 * are covered by `detail-page-offline-gating.test.tsx`.
 */

type ApiMethodRef = {
  namespace: CalibraApiNamespace
  method: string
}

type DesktopOfflineRoute = {
  to: FileRouteTypes['to']
  renders: readonly ApiMethodRef[]
}

function reads<TNamespace extends CalibraApiNamespace>(
  namespace: TNamespace,
  ...methods: CalibraApiMethod<TNamespace>[]
): ApiMethodRef[] {
  return methods.map((method) => ({ namespace, method }))
}

export const desktopOfflineRoutes = [
  // Reference reads
  { to: '/dashboard/clients', renders: reads('customers', 'list') },
  {
    to: '/dashboard/clients/$id/overview',
    renders: [
      ...reads('customers', 'get'),
      ...reads('assets', 'list'),
      ...reads('jobs', 'list'),
    ],
  },
  {
    to: '/dashboard/clients/$id/assets',
    renders: [...reads('customers', 'get'), ...reads('assets', 'list')],
  },
  {
    to: '/dashboard/clients/$id/calibrations',
    renders: [...reads('customers', 'get'), ...reads('jobs', 'list')],
  },
  { to: '/dashboard/assets', renders: reads('assets', 'list') },
  { to: '/dashboard/assets/$id', renders: reads('assets', 'get') },
  { to: '/dashboard/standards', renders: reads('standards', 'list') },
  { to: '/dashboard/standards/$id', renders: reads('standards', 'get') },
  { to: '/dashboard/methods', renders: reads('methods', 'list') },
  { to: '/dashboard/methods/$id', renders: reads('methods', 'get') },

  // Intake: a service order, or a minimal asset stub
  {
    to: '/dashboard/assets/new',
    renders: [
      ...reads('assets', 'create'),
      ...reads('assetTypes', 'list'),
      ...reads('customers', 'list'),
    ],
  },
  { to: '/dashboard/service-orders', renders: reads('serviceOrders', 'list') },
  {
    to: '/dashboard/service-orders/new',
    renders: [
      ...reads('serviceOrders', 'create'),
      ...reads('customers', 'list'),
      ...reads('assets', 'list'),
    ],
  },
  {
    to: '/dashboard/service-orders/$publicId',
    renders: reads('serviceOrders', 'getByPublicId'),
  },

  // Field capture: an assigned job, executed from the read-only pack
  { to: '/dashboard/jobs', renders: reads('jobs', 'list') },
  { to: '/dashboard/jobs/$id', renders: reads('jobs', 'get') },
  {
    to: '/dashboard/jobs/$id/execute',
    renders: [
      ...reads(
        'jobs',
        'get',
        'listStandards',
        'getEffectiveEnvironmentalLimits',
        'saveExecution',
        'submitExecution',
      ),
      ...reads('standards', 'listCompositionProfiles'),
    ],
  },

  // The desktop's own sync machinery
  {
    to: '/dashboard/sync/conflicts',
    renders: reads('sync', 'listConflicts', 'listDeadEvents'),
  },
] as const satisfies readonly DesktopOfflineRoute[]

function isLocalMethod({ namespace, method }: ApiMethodRef): boolean {
  return listCalibraApiPolicyEntries().some(
    (entry) =>
      entry.namespace === namespace &&
      entry.method === method &&
      entry.policy !== 'cloud-only',
  )
}

/**
 * Router `to` for a TanStack route id: ids end with a slash for index routes
 * (`/dashboard/jobs/`); `to` does not.
 */
export function toRouteTo(routeId: string): string {
  return routeId.length > 1 && routeId.endsWith('/')
    ? routeId.slice(0, -1)
    : routeId
}

/** True when the route renders from local data, so it works without the cloud. */
export function isDesktopOfflineRoute(routeId: string): boolean {
  const to = toRouteTo(routeId)
  const route = desktopOfflineRoutes.find((candidate) => candidate.to === to)
  if (!route) return false

  return route.renders.every(isLocalMethod)
}
