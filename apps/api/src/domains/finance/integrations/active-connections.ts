import { systemDb } from "@calibra-facil/db";
import {
  integrationConnection,
  organizationIntegration,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * The Conta Azul cron sweeps (scheduled sync, payment / payable / fiscal /
 * protocol / drift / stock polling) have no request to name a laboratory, so the
 * one statement that learns WHICH laboratories hold an active Conta Azul
 * connection runs on the SYSTEM path (`systemDb`, the owner connection;
 * tenant-sql-allowlist.ts "cron-queue"). It returns ids and the connection's own
 * (non-secret) config; every statement after it (runs, events, links, cursors,
 * the remote calls' bookkeeping) runs in `orgDb(row.organizationId).transaction`.
 */
export async function listActiveContaAzulConnections() {
  return systemDb
    .select({
      integrationId: organizationIntegration.id,
      organizationId: organizationIntegration.organizationId,
      config: integrationConnection.config,
    })
    .from(organizationIntegration)
    .innerJoin(
      integrationConnection,
      eq(integrationConnection.integrationId, organizationIntegration.id),
    )
    .where(
      and(
        eq(organizationIntegration.status, "ACTIVE"),
        eq(organizationIntegration.provider, "conta_azul"),
      ),
    );
}
