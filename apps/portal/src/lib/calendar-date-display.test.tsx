import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createTable,
  flexRender,
  getCoreRowModel,
  type ColumnDef,
} from "@tanstack/react-table";
import { describe, expect, it, vi } from "vitest";

// The fleet columns only need <Link> from the router.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

import { fleetColumns } from "@/features/fleet/columns";
import type { FleetAsset } from "@/features/fleet/types";
import { groupDuesByDay } from "@/features/calendar/lib";
import type { CalendarDueAsset } from "@/features/calendar/queries";
import { LegalVerificationPanel } from "@/features/assets/legal-verification-panel";
import type { AssetDetail } from "@/features/assets/types";
import { describeDueDate } from "@/features/certificates/verdict";

// REQ-CAL-001: calendar dates are Postgres `date` columns, so the API returns
// UTC midnight of the day they name. Read in the browser's zone
// (America/Sao_Paulo, pinned by the vitest global setup) that instant is the
// EVENING BEFORE: every portal screen must show and count the day it names.

const STORED = "2026-10-15T00:00:00.000Z";

function rowOf<T>(fields: object): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- a table cell or panel only reads the fields the test sets; building every field of the payload would hide what is under test.
  return fields as T;
}

function renderCell<T extends object>(
  columns: ColumnDef<T>[],
  accessorKey: string,
  data: T,
): string {
  const table = createTable<T>({
    data: [data],
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: {},
    onStateChange: () => {},
    renderFallbackValue: null,
  });
  table.setOptions((previous) => ({
    ...previous,
    state: { ...table.initialState },
  }));
  const [row] = table.getRowModel().rows;
  const cell = row?.getVisibleCells().find((candidate) => {
    const def = candidate.column.columnDef;
    return "accessorKey" in def && def.accessorKey === accessorKey;
  });
  if (!cell) throw new Error(`no ${accessorKey} column`);
  return renderToStaticMarkup(
    flexRender(cell.column.columnDef.cell, cell.getContext()),
  );
}

describe("stored calendar dates show on the day they name (portal)", () => {
  it("shows the next calibration in the fleet table", () => {
    const html = renderCell(
      fleetColumns,
      "nextCalibrationDate",
      rowOf<FleetAsset>({ nextCalibrationDate: STORED }),
    );
    expect(html).toContain("15 de out. de 2026");
    expect(html).not.toContain("14 de out.");
  });

  it("shows the next legal verification of a legal-metrology instrument", () => {
    const html = renderToStaticMarkup(
      <LegalVerificationPanel
        asset={rowOf<AssetDetail>({
          metrologyRegime: "LEGAL",
          nextLegalVerificationDate: STORED,
          regulatedInterval: {
            kind: "fixed",
            regulationReference: "Portaria",
            operationalizedByDelegate: false,
          },
        })}
      />,
    );
    expect(html).toContain("15 de out. de 2026");
  });

  it("places an instrument on the calendar day it is due", () => {
    const due: CalendarDueAsset = {
      id: 1,
      publicId: "pub-1",
      name: "Balança",
      tag: "EQ-1",
      assetTypeName: "Balança",
      nextCalibrationDate: STORED,
      inLab: false,
    };
    expect([...groupDuesByDay([due]).keys()]).toEqual(["2026-10-15"]);
  });

  it("counts the days to the next calibration by the day it names", () => {
    // 09:00 on the 15th: due today, not overdue.
    const now = new Date("2026-10-15T12:00:00.000Z").getTime();
    expect(describeDueDate(STORED, now)).toEqual({
      tone: "warning",
      hint: "vence em 0 d",
    });
    // 22:00 on the 14th (01:00Z on the 15th): one day to go, not "today".
    expect(
      describeDueDate(STORED, new Date("2026-10-15T01:00:00.000Z").getTime()),
    ).toEqual({ tone: "warning", hint: "vence em 1 d" });
    // 00:10 on the 16th: overdue.
    expect(
      describeDueDate(STORED, new Date("2026-10-16T03:10:00.000Z").getTime()),
    ).toEqual({ tone: "critical", hint: "vencido" });
  });
});
