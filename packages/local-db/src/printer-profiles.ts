import {
  PrinterProfileSchema,
  type PrinterProfile,
} from "@calibra-facil/schemas";

import type { LocalDatabase } from "./database";

// Thermal-printer profiles are workstation-local: each desktop install stores
// the printers it can reach (connection target + label layout). Cloud mode does
// not use this table (Zebra Browser Print enumerates devices client-side).

type PrinterProfileRow = {
  id: string;
  name: string;
  connection_json: string;
  dpi: number;
  darkness: number;
  speed: number;
  width_dots: number;
  height_dots: number;
  offsets_json: string;
  is_default: number;
};

function rowToProfile(row: PrinterProfileRow): PrinterProfile {
  const connection: unknown = JSON.parse(row.connection_json);
  const offsets: unknown = JSON.parse(row.offsets_json);
  return PrinterProfileSchema.parse({
    id: row.id,
    name: row.name,
    connection,
    dpi: row.dpi,
    darkness: row.darkness,
    speed: row.speed,
    widthDots: row.width_dots,
    heightDots: row.height_dots,
    offsets,
    isDefault: row.is_default === 1,
  });
}

export function listPrinterProfiles(database: LocalDatabase): PrinterProfile[] {
  return database
    .prepare<
      [],
      PrinterProfileRow
    >(`SELECT * FROM printer_profiles ORDER BY is_default DESC, name ASC`)
    .all()
    .map(rowToProfile);
}

export function getPrinterProfile(
  database: LocalDatabase,
  id: string,
): PrinterProfile | null {
  const row = database
    .prepare<
      { id: string },
      PrinterProfileRow
    >(`SELECT * FROM printer_profiles WHERE id = @id`)
    .get({ id });
  return row ? rowToProfile(row) : null;
}

export function getDefaultPrinterProfile(
  database: LocalDatabase,
): PrinterProfile | null {
  const row = database
    .prepare<
      [],
      PrinterProfileRow
    >(`SELECT * FROM printer_profiles WHERE is_default = 1 LIMIT 1`)
    .get();
  return row ? rowToProfile(row) : null;
}

export function upsertPrinterProfile(
  database: LocalDatabase,
  profile: PrinterProfile,
): PrinterProfile {
  const now = new Date().toISOString();
  const persist = database.transaction(() => {
    // Enforce a single default profile.
    if (profile.isDefault) {
      database
        .prepare<
          { id: string },
          unknown
        >(`UPDATE printer_profiles SET is_default = 0 WHERE id != @id`)
        .run({ id: profile.id });
    }

    database
      .prepare<
        {
          id: string;
          name: string;
          connectionJson: string;
          dpi: number;
          darkness: number;
          speed: number;
          widthDots: number;
          heightDots: number;
          offsetsJson: string;
          isDefault: number;
          now: string;
        },
        unknown
      >(
        `
INSERT INTO printer_profiles
  (id, name, connection_json, dpi, darkness, speed, width_dots, height_dots, offsets_json, is_default, created_at, updated_at)
VALUES
  (@id, @name, @connectionJson, @dpi, @darkness, @speed, @widthDots, @heightDots, @offsetsJson, @isDefault, @now, @now)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  connection_json = excluded.connection_json,
  dpi = excluded.dpi,
  darkness = excluded.darkness,
  speed = excluded.speed,
  width_dots = excluded.width_dots,
  height_dots = excluded.height_dots,
  offsets_json = excluded.offsets_json,
  is_default = excluded.is_default,
  updated_at = excluded.updated_at
`,
      )
      .run({
        id: profile.id,
        name: profile.name,
        connectionJson: JSON.stringify(profile.connection),
        dpi: profile.dpi,
        darkness: profile.darkness,
        speed: profile.speed,
        widthDots: profile.widthDots,
        heightDots: profile.heightDots,
        offsetsJson: JSON.stringify(profile.offsets),
        isDefault: profile.isDefault ? 1 : 0,
        now,
      });
  });

  persist();
  return profile;
}

export function deletePrinterProfile(
  database: LocalDatabase,
  id: string,
): void {
  database
    .prepare<
      { id: string },
      unknown
    >(`DELETE FROM printer_profiles WHERE id = @id`)
    .run({ id });
}
