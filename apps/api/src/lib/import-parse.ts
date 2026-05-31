import { Workbook } from "@cj-tech-master/excelts";

/**
 * Server-side spreadsheet parsing for the migration importer (gap #12).
 *
 * Reuses `@cj-tech-master/excelts` (the ExcelJS fork already used by the
 * certificate templates) so `.xlsx`/`.xls` uploads go through a real parser
 * instead of being hand-rolled. The first worksheet's first row is treated as
 * the header; every later non-empty row becomes a string cell array. Kept on the
 * server to keep the browser bundle light (consistent with the repo's xlsx use).
 */

export type ParsedSpreadsheet = {
  sheetName: string;
  headers: string[];
  rows: string[][];
};

/** Hard cap so a pathological file can't blow up memory / the payload. */
export const MAX_PARSED_ROWS = 5000;

export async function parseSpreadsheet(
  data: Uint8Array,
): Promise<ParsedSpreadsheet> {
  const workbook = new Workbook();
  await workbook.xlsx.load(data);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { sheetName: "", headers: [], rows: [] };
  }

  const columnCount = Math.max(sheet.actualColumnCount, sheet.columnCount, 0);
  const cellText = (rowNumber: number, columnNumber: number): string => {
    const value = sheet.getRow(rowNumber).getCell(columnNumber).text;
    return typeof value === "string" ? value : value == null ? "" : String(value);
  };

  const headers: string[] = [];
  for (let column = 1; column <= columnCount; column++) {
    headers.push(cellText(1, column).trim());
  }
  // Trim trailing empty header columns.
  while (headers.length > 0 && headers[headers.length - 1] === "") {
    headers.pop();
  }
  const effectiveColumns = headers.length;

  const rows: string[][] = [];
  for (
    let rowNumber = 2;
    rowNumber <= sheet.rowCount && rows.length < MAX_PARSED_ROWS;
    rowNumber++
  ) {
    const cells: string[] = [];
    for (let column = 1; column <= effectiveColumns; column++) {
      cells.push(cellText(rowNumber, column));
    }
    if (cells.some((value) => value.trim() !== "")) {
      rows.push(cells);
    }
  }

  return { sheetName: sheet.name, headers, rows };
}
