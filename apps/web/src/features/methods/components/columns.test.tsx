// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

import { DataTable } from '@/components/ui/data-table'
import { methodsColumns, type Method } from './columns'
import type { MethodStatus } from '@/features/methods/types'

function method(status: MethodStatus): Method {
  return {
    id: 1,
    name: 'Calibração de Instrumento de Pesagem Não-Automático (NAWI)',
    description: null,
    assetTypeId: 1,
    assetTypeName: 'Balança Digital',
    version: 1,
    status,
    dataFields: [],
    formulas: [],
    validations: [],
    createdAt: '2026-09-10T00:00:00.000Z',
    publishedAt: null,
    parentId: null,
  }
}

function renderRow(status: MethodStatus) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <DataTable columns={methodsColumns} data={[method(status)]} />
    ),
  })
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dashboard/methods/$id',
    component: () => <p>detalhe</p>,
  })
  const editRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dashboard/methods/$id/edit',
    component: () => <p>edicao</p>,
  })

  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, detailRoute, editRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(<RouterProvider router={router} />)
}

afterEach(cleanup)

describe('methods list row actions', () => {
  /**
   * REGRESSION: the menu only ever held items for DRAFT and PUBLISHED, so a
   * method "Em aprovação" (or "Revisão técnica", or "Arquivado") opened an
   * EMPTY dropdown — a control leading nowhere, right where a reviewer looks
   * for the approval step.
   */
  const statuses: Array<MethodStatus> = [
    'DRAFT',
    'PENDING_APPROVAL',
    'TECHNICAL_REVIEWED',
    'PUBLISHED',
    'ARCHIVED',
  ]

  for (const status of statuses) {
    it(`offers at least one action for a ${status} method`, async () => {
      renderRow(status)

      const triggers = await screen.findAllByRole('button')
      fireEvent.click(triggers[0]!)

      const item = await screen.findByText('Ver detalhes')
      expect(item).toBeTruthy()
    })
  }
})
