import {
  type ColumnDef,
  type SortingState,
  type OnChangeFn,
  type ColumnFiltersState,
  type TableMeta,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";
import { Skeleton } from "./skeleton";
import { DataTablePagination } from "./data-table-pagination";

interface PaginationInfo {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  pagination?: PaginationInfo;
  onPageChange?: (page: number) => void;
  isLoading?: boolean;
  onRowClick?: (row: TData) => void;
  meta?: TableMeta<TData>;
  /** Noun used by the pagination summary (e.g. "ordens de serviço"). */
  itemName?: string;
  /**
   * Controlled sorting: when provided, the table stops sorting rows itself
   * (`manualSorting`) and reports header clicks via `onSortingChange` — for
   * server-side sorting alongside server-side pagination.
   */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  pagination,
  onPageChange,
  isLoading = false,
  onRowClick,
  meta,
  itemName,
  sorting,
  onSortingChange,
}: DataTableProps<TData, TValue>) {
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const sortingIsControlled = sorting !== undefined;
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: sortingIsControlled,
    onSortingChange:
      sortingIsControlled && onSortingChange
        ? onSortingChange
        : setInternalSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting: sorting ?? internalSorting,
      columnFilters,
    },
    meta,
  });

  if (isLoading) {
    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((_, i) => (
                <TableHead key={i}>
                  <Skeleton className="h-4 w-20" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {columns.map((_, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        {/* On a phone the table keeps a readable width and scrolls sideways,
            instead of squeezing every column to a word per line. */}
        <Table
          className={
            table.getVisibleLeafColumns().length > 4
              ? "min-w-[48rem] lg:min-w-0"
              : undefined
          }
        >
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : header.column.columnDef
                        .header ? (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    ) : header.column.id === "actions" ? (
                      // A row-actions column still needs a header name.
                      <span className="sr-only">Ações</span>
                    ) : null}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className={
                    onRowClick
                      ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      : ""
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={(event) => {
                    if (isInteractiveEventTarget(event.target)) return;

                    onRowClick?.(row.original);
                  }}
                  onKeyDown={(event) => {
                    if (!onRowClick || isInteractiveEventTarget(event.target)) {
                      return;
                    }

                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onRowClick(row.original);
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  Nenhum resultado encontrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && pagination.totalPages > 1 && onPageChange && (
        <DataTablePagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          limit={pagination.limit}
          onPageChange={onPageChange}
          itemName={itemName}
        />
      )}
    </div>
  );
}

function isInteractiveEventTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'a,button,input,select,textarea,[role="button"],[role="link"]',
      ),
    )
  );
}
