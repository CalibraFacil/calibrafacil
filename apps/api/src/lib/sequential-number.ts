import type { OrgDb } from "@calibra-facil/db/for-org";
import { and, desc, eq, ilike } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { getLabCalendarDay } from "@calibra-facil/shared/calendar-date";
import { isUniqueViolation } from "./db-errors";

const MAX_SEQ_RETRIES = 3;

export type SequentialNumbering<Row> = {
  /** Table-and-column of the numbered record (`nonConformance.ncNumber`...). */
  table: PgTable;
  organizationColumn: PgColumn;
  numberColumn: PgColumn;
  /** Number prefix: `NC` gives `NC-2026-0001`. */
  prefix: string;
  /** Inserts the record with the given number and returns its row. */
  insert: (tx: OrgDb, number: string) => Promise<Row[]>;
};

/**
 * Inserts a record with the next number of its laboratory's yearly sequence
 * (`PREFIX-YYYY-NNNN`): reads the last number, adds one and inserts, retrying
 * on the unique violation a concurrent creator causes. Each attempt is a
 * savepoint of the caller's transaction, because a unique violation aborts a
 * Postgres transaction and the retry would fail with it unless only that
 * attempt is rolled back. The one numbering of non-conformances and CAPAs.
 */
export async function insertWithSequentialNumber<Row>(
  o: OrgDb,
  numbering: SequentialNumbering<Row>,
): Promise<Row> {
  for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
    const number = await nextSequentialNumber(o, numbering);
    try {
      const [inserted] = await o.transaction((tx) =>
        numbering.insert(tx, number),
      );
      if (inserted) return inserted;
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === MAX_SEQ_RETRIES - 1) throw err;
    }
  }
  throw new Error(`Falha ao gerar o numero ${numbering.prefix}`);
}

async function nextSequentialNumber(
  o: OrgDb,
  numbering: SequentialNumbering<unknown>,
): Promise<string> {
  // The laboratory's year, not the server's: a number is named after the lab's day.
  const { year } = getLabCalendarDay(new Date());
  const [last] = await o
    .select({ number: numbering.numberColumn })
    .from(numbering.table)
    .where(
      and(
        eq(numbering.organizationColumn, o.organizationId),
        ilike(numbering.numberColumn, `${numbering.prefix}-${year}-%`),
      ),
    )
    .orderBy(desc(numbering.numberColumn))
    .limit(1);

  const lastNumber = last?.number;
  const lastSequence =
    typeof lastNumber === "string"
      ? parseInt(lastNumber.split("-")[2] ?? "0", 10)
      : 0;
  return `${numbering.prefix}-${year}-${String(lastSequence + 1).padStart(4, "0")}`;
}
