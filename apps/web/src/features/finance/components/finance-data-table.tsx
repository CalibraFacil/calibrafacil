import * as React from 'react'
import {
  type ColumnDef,
  type ColumnFiltersState,
  type Row,
  type RowData,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DataTableFacetedFilter,
  type FacetOption,
} from '@/components/ui/data-table-faceted-filter'
import { DataTableViewOptions } from '@/components/ui/data-table-view-options'

// Optional per-column display label used by the column-visibility menu.
declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    label?: string
  }
}

export type FacetConfig = {
  columnId: string
  title: string
  options: FacetOption[]
}

const EMPTY_FACETS: ReadonlyArray<FacetConfig> = []
const EMPTY_SORTING: SortingState = []
const EMPTY_FILTERS: ColumnFiltersState = []

// Global search: case-insensitive substring match across every cell value.
function globalIncludesFilter<TData>(
  row: Row<TData>,
  _columnId: string,
  filterValue: unknown,
): boolean {
  const query = String(filterValue).trim().toLowerCase()
  if (!query) return true
  return row
    .getAllCells()
    .some((cell) =>
      String(cell.getValue() ?? '')
        .toLowerCase()
        .includes(query),
    )
}

function createSelectionColumn<TData>(): ColumnDef<TData, unknown> {
  return {
    id: '__select',
    enableSorting: false,
    enableHiding: false,
    header: ({ table }) => (
      <Checkbox
        aria-label="Selecionar todos"
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={
          table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()
        }
        onCheckedChange={(value) =>
          table.toggleAllPageRowsSelected(value === true)
        }
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label="Selecionar linha"
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(value === true)}
      />
    ),
  }
}

function isInteractiveTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'a,button,input,select,textarea,[role="button"],[role="checkbox"],[role="menuitem"]',
      ),
    )
  )
}

export function FinanceDataTable<TData>({
  columns,
  data,
  isLoading = false,
  getRowId,
  facets = EMPTY_FACETS,
  searchPlaceholder = 'Buscar…',
  enableSearch = true,
  enableRowSelection = false,
  bulkActions,
  onRowClick,
  initialSorting = EMPTY_SORTING,
  initialColumnFilters = EMPTY_FILTERS,
  pageSize = 12,
  emptyState = 'Nenhum resultado.',
}: {
  columns: ColumnDef<TData, unknown>[]
  data: TData[]
  isLoading?: boolean
  getRowId?: (row: TData) => string
  facets?: ReadonlyArray<FacetConfig>
  searchPlaceholder?: string
  enableSearch?: boolean
  enableRowSelection?: boolean | ((row: Row<TData>) => boolean)
  bulkActions?: (selected: TData[], clearSelection: () => void) => React.ReactNode
  onRowClick?: (row: TData) => void
  initialSorting?: SortingState
  initialColumnFilters?: ColumnFiltersState
  pageSize?: number
  emptyState?: React.ReactNode
}) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting)
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>(initialColumnFilters)
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = React.useState({})
  const [globalFilter, setGlobalFilter] = React.useState('')

  const allColumns = React.useMemo<ColumnDef<TData, unknown>[]>(
    () =>
      enableRowSelection ? [createSelectionColumn<TData>(), ...columns] : columns,
    [columns, enableRowSelection],
  )

  const table = useReactTable({
    data,
    columns: allColumns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter,
    },
    enableRowSelection,
    getRowId,
    globalFilterFn: globalIncludesFilter,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  })

  const isFiltered = columnFilters.length > 0 || globalFilter.trim() !== ''
  const selectedRows = table
    .getSelectedRowModel()
    .rows.map((row) => row.original)
  const filteredCount = table.getFilteredRowModel().rows.length
  const { pageIndex, pageSize: currentPageSize } = table.getState().pagination
  const rangeStart = filteredCount === 0 ? 0 : pageIndex * currentPageSize + 1
  const rangeEnd = Math.min((pageIndex + 1) * currentPageSize, filteredCount)

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <div className="rounded-xl border">
          {['s1', 's2', 's3', 's4', 's5'].map((key) => (
            <div key={key} className="flex gap-4 border-b p-3 last:border-0">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {enableSearch ? (
          <div className="relative w-full sm:w-64">
            <HugeiconsIcon
              icon={Search01Icon}
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={globalFilter}
              onChange={(event) => setGlobalFilter(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 pl-8"
            />
          </div>
        ) : null}
        {facets.map((facet) => (
          <DataTableFacetedFilter
            key={facet.columnId}
            column={table.getColumn(facet.columnId)}
            title={facet.title}
            options={facet.options}
          />
        ))}
        {isFiltered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              table.resetColumnFilters()
              setGlobalFilter('')
            }}
          >
            Limpar
            <HugeiconsIcon icon={Cancel01Icon} className="ml-1.5 size-3.5" />
          </Button>
        ) : null}
        <DataTableViewOptions table={table} />
      </div>

      {enableRowSelection && selectedRows.length > 0 && bulkActions ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 p-2.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)]">
          <span className="px-1 text-sm font-medium">
            {selectedRows.length} selecionado(s)
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {bulkActions(selectedRows, () => table.resetRowSelection())}
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  className={
                    onRowClick
                      ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={(event) => {
                    if (isInteractiveTarget(event.target)) return
                    onRowClick?.(row.original)
                  }}
                  onKeyDown={(event) => {
                    if (!onRowClick || isInteractiveTarget(event.target)) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onRowClick(row.original)
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={allColumns.length}
                  className="h-28 text-center text-sm text-muted-foreground"
                >
                  {emptyState}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {filteredCount === 0
            ? 'Nenhum resultado'
            : `Mostrando ${rangeStart}–${rangeEnd} de ${filteredCount}`}
        </p>
        {table.getPageCount() > 1 ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
            </Button>
            <span className="px-1 text-sm tabular-nums text-muted-foreground">
              {pageIndex + 1} / {table.getPageCount()}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
