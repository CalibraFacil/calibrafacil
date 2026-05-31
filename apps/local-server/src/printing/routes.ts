import { randomUUID } from "node:crypto";

import {
  deletePrinterProfile,
  getDefaultPrinterProfile,
  getPrinterProfile,
  listPrinterProfiles,
  upsertPrinterProfile,
  type LocalDatabase,
} from "@calibra-facil/local-db";
import { buildTestLabelZpl } from "@calibra-facil/label-zpl";
import {
  PrinterProfileSchema,
  PrintLabelRequestSchema,
  PrintTestRequestSchema,
  SavePrinterProfileSchema,
  type PrinterProfile,
  type PrintResult,
} from "@calibra-facil/schemas";
import type { Hono } from "hono";

import { PrinterTransportError } from "./errors";
import { sendToPrinter } from "./transport-types";

function resolveProfile(
  database: LocalDatabase,
  target: { profileId?: string; profile?: PrinterProfile },
): PrinterProfile | null {
  if (target.profile) return target.profile;
  if (target.profileId) return getPrinterProfile(database, target.profileId);
  return getDefaultPrinterProfile(database);
}

async function printZpl(
  profile: PrinterProfile,
  zpl: string,
): Promise<PrintResult> {
  try {
    const bytesSent = await sendToPrinter(profile, zpl);
    return { success: true, bytesSent };
  } catch (error) {
    if (error instanceof PrinterTransportError) {
      return { success: false, error: error.message };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Mount the desktop thermal-printing routes. They live under `/api/printer/*`
 * so they inherit the local-server token gate.
 */
export function registerPrinterRoutes(
  app: Hono,
  database: LocalDatabase,
): void {
  app.get("/api/printer/profiles", (c) => {
    return c.json({ profiles: listPrinterProfiles(database) });
  });

  app.post("/api/printer/profiles", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = SavePrinterProfileSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "Perfil de impressora inválido",
          details: parsed.error.flatten(),
        },
        400,
      );
    }

    const profile = PrinterProfileSchema.parse({
      ...parsed.data,
      id: parsed.data.id ?? randomUUID(),
      isDefault: parsed.data.isDefault ?? false,
    });
    upsertPrinterProfile(database, profile);
    return c.json({ profile });
  });

  app.delete("/api/printer/profiles/:id", (c) => {
    deletePrinterProfile(database, c.req.param("id"));
    return c.json({ success: true });
  });

  app.post("/api/printer/print", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = PrintLabelRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { success: false, error: "Requisição de impressão inválida" },
        400,
      );
    }
    // Phase 1: the client renders/fetches ZPL (cloud `label.zpl`) and posts it;
    // building from `jobId` locally arrives with offline label data later.
    if (!parsed.data.zpl) {
      return c.json(
        {
          success: false,
          error: "ZPL é obrigatório. Gere a etiqueta antes de imprimir.",
        },
        422,
      );
    }

    const profile = resolveProfile(database, parsed.data);
    if (!profile) {
      return c.json(
        { success: false, error: "Nenhuma impressora configurada." },
        404,
      );
    }

    return c.json(await printZpl(profile, parsed.data.zpl));
  });

  app.post("/api/printer/test", async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = PrintTestRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: "Requisição inválida" }, 400);
    }

    const profile = resolveProfile(database, parsed.data);
    if (!profile) {
      return c.json(
        { success: false, error: "Nenhuma impressora configurada." },
        404,
      );
    }

    return c.json(await printZpl(profile, buildTestLabelZpl(profile)));
  });
}
