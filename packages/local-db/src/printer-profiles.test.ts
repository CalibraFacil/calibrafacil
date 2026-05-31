import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { PrinterProfileSchema } from "@calibra-facil/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  deletePrinterProfile,
  getDefaultPrinterProfile,
  getPrinterProfile,
  listPrinterProfiles,
  openLocalDatabase,
  upsertPrinterProfile,
} from "./index";

const tempDirectories: string[] = [];

function openTempDatabase() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-printer-db-"));
  tempDirectories.push(directory);
  return openLocalDatabase({ filePath: path.join(directory, "calibra.sqlite") });
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const networkProfile = PrinterProfileSchema.parse({
  id: "bench",
  name: "Bench Zebra",
  connection: { type: "network", host: "192.168.0.10" },
  dpi: 203,
  widthDots: 400,
  heightDots: 240,
  isDefault: true,
});

const usbProfile = PrinterProfileSchema.parse({
  id: "office",
  name: "Office Zebra",
  connection: { type: "usb", vendorId: 0x0a5f, productId: 0x0001 },
  dpi: 300,
  widthDots: 591,
  heightDots: 354,
  isDefault: true,
});

describe("printer profile repository", () => {
  it("round-trips a profile through SQLite (connection JSON preserved)", () => {
    const database = openTempDatabase();
    upsertPrinterProfile(database, networkProfile);

    const stored = getPrinterProfile(database, "bench");
    expect(stored).toEqual(networkProfile);
    expect(getDefaultPrinterProfile(database)?.id).toBe("bench");
    expect(listPrinterProfiles(database)).toHaveLength(1);
  });

  it("keeps exactly one default profile", () => {
    const database = openTempDatabase();
    upsertPrinterProfile(database, networkProfile);
    upsertPrinterProfile(database, usbProfile);

    expect(getDefaultPrinterProfile(database)?.id).toBe("office");
    const all = listPrinterProfiles(database);
    expect(all).toHaveLength(2);
    // Ordered default-first.
    expect(all[0]?.id).toBe("office");
    expect(all.filter((profile) => profile.isDefault)).toHaveLength(1);
  });

  it("updates an existing profile in place", () => {
    const database = openTempDatabase();
    upsertPrinterProfile(database, networkProfile);
    upsertPrinterProfile(database, { ...networkProfile, name: "Bench Zebra v2" });

    expect(listPrinterProfiles(database)).toHaveLength(1);
    expect(getPrinterProfile(database, "bench")?.name).toBe("Bench Zebra v2");
  });

  it("deletes a profile", () => {
    const database = openTempDatabase();
    upsertPrinterProfile(database, networkProfile);
    upsertPrinterProfile(database, usbProfile);

    deletePrinterProfile(database, "office");

    expect(listPrinterProfiles(database)).toHaveLength(1);
    expect(getPrinterProfile(database, "office")).toBeNull();
  });
});
