/**
 * The paged bootstrap (protocol 3): `POST /api/sync/bootstrap/page`.
 * docs/architecture/sync-change-seq.md.
 *
 * The entities are walked in `SYNC_ENTITY_SOURCES` order, each by ascending id, and the
 * page is cut after `limit` rows wherever that falls (a page may span entities). The
 * walk position is the page token `b3|<xmin>|<rank>|<lastId>`; it carries everything the
 * server needs, so there is no server-side session and an interrupted desktop resumes
 * from the last page it applied.
 *
 * `<xmin>` is the oldest transaction id in flight when the FIRST page was cut, and the
 * cursor handed out for the pull that follows is `v3|<xmin>|0`. Every change of a
 * transaction below `xmin` finished before the first page was read, so the pages (read
 * later) include it; every change of a transaction at or above `xmin` has a log entry the
 * pull will serve. A row that changes while the pages are being walked is therefore read
 * at whichever state a page caught it in and sent again by the pull: the desktop applies
 * both, and the second is the newer. A row deleted meanwhile is skipped by the walk and
 * tombstoned by the pull.
 */
import { eq, sql } from "drizzle-orm";
import { organization } from "@calibra-facil/db/schema";
import {
  SYNC_BOOTSTRAP_DEFAULT_PAGE_SIZE,
  SYNC_CHANGE_SEQ_PROTOCOL_VERSION,
  type SyncBootstrapPageRequest,
  type SyncBootstrapPageResponse,
  formatSyncChangeCursor,
  syncBootstrapPageResponseSchema,
} from "@calibra-facil/contracts";
import type { OrgDb } from "@calibra-facil/db/for-org";
import { orgDb } from "../../lib/org-db";
import type { MemberData } from "../../middleware/permission";
import {
  SYNC_ENTITY_SOURCES,
  type SyncEntityRow,
  type SyncScope,
  syncScopeFingerprint,
} from "./entity-sources";

/** Row ids are Postgres `serial` (int4). */
const MAX_SERIAL_ID = 2_147_483_647;
const TOKEN_PATTERN = /^b3\|(\d{1,20})\|(\d{1,3})\|(\d{1,10})$/;

type Walk = { xmin: bigint; rank: number; afterId: number };

export function parseBootstrapPageToken(token: string): Walk | null {
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const [, rawXmin, rawRank, rawId] = match;
  if (rawXmin === undefined || rawRank === undefined || rawId === undefined) {
    return null;
  }
  const rank = Number(rawRank);
  const afterId = Number(rawId);
  if (
    rank >= SYNC_ENTITY_SOURCES.length ||
    !Number.isSafeInteger(afterId) ||
    afterId > MAX_SERIAL_ID
  ) {
    return null;
  }
  return { xmin: BigInt(rawXmin), rank, afterId };
}

function formatToken(walk: Walk): string {
  return `b3|${walk.xmin}|${walk.rank}|${walk.afterId}`;
}

type EntityArrays = Pick<
  SyncBootstrapPageResponse,
  | "publishedMethods"
  | "assetTypes"
  | "customers"
  | "assets"
  | "services"
  | "standards"
  | "environmentalLimits"
  | "jobs"
  | "serviceOrders"
> & { massCompositionProfiles: unknown[] };

function emptyArrays(): EntityArrays {
  return {
    publishedMethods: [],
    assetTypes: [],
    customers: [],
    assets: [],
    services: [],
    standards: [],
    environmentalLimits: [],
    jobs: [],
    serviceOrders: [],
    massCompositionProfiles: [],
  };
}

function arrayFor(
  arrays: EntityArrays,
  entityType: (typeof SYNC_ENTITY_SOURCES)[number]["entityType"],
): unknown[] {
  switch (entityType) {
    case "asset_type":
      return arrays.assetTypes;
    case "customer":
      return arrays.customers;
    case "asset":
      return arrays.assets;
    case "service":
      return arrays.services;
    case "reference_standard":
      return arrays.standards;
    case "environmental_limit":
      return arrays.environmentalLimits;
    case "calibration_job":
      return arrays.jobs;
    case "service_order":
      return arrays.serviceOrders;
    case "published_method":
      return arrays.publishedMethods;
    case "mass_composition_profile":
      return arrays.massCompositionProfiles;
  }
}

export type BootstrapPage =
  | { kind: "invalid_token" }
  | {
      kind: "page";
      syncCursor: string;
      nextToken: string | null;
      rowCount: number;
      arrays: EntityArrays;
    };

export async function loadBootstrapPage(input: {
  scope: SyncScope;
  pageToken: string | null | undefined;
  limit: number;
}): Promise<BootstrapPage> {
  // One transaction that names the laboratory (row-level security), READ
  // COMMITTED as before: each statement takes its own snapshot, the walk's xmin
  // is read in one statement, and a page is a walk over ids, so the argument in
  // the header of this file is unchanged. The transaction has no transaction id
  // of its own, so it is never the "oldest in flight" the xmin names.
  return orgDb(input.scope.organizationId).transaction((o) =>
    loadBootstrapPageIn(o, input),
  );
}

async function loadBootstrapPageIn(
  o: OrgDb,
  input: {
    scope: SyncScope;
    pageToken: string | null | undefined;
    limit: number;
  },
): Promise<BootstrapPage> {
  let walk: Walk;
  if (input.pageToken === null || input.pageToken === undefined) {
    const [snapshot] = await o
      .select({
        xmin: sql<string>`pg_snapshot_xmin(pg_current_snapshot())::text`,
      })
      .from(organization)
      .where(eq(organization.id, input.scope.organizationId));
    if (!snapshot) return { kind: "invalid_token" };
    walk = { xmin: BigInt(snapshot.xmin), rank: 0, afterId: 0 };
  } else {
    const parsed = parseBootstrapPageToken(input.pageToken);
    if (!parsed) return { kind: "invalid_token" };
    walk = parsed;
  }

  const arrays = emptyArrays();
  let remaining = input.limit;
  let rowCount = 0;
  let { rank, afterId } = walk;
  while (rank < SYNC_ENTITY_SOURCES.length && remaining > 0) {
    const source = SYNC_ENTITY_SOURCES[rank];
    if (!source) break;
    const rows: SyncEntityRow[] = await source.page(
      o,
      input.scope,
      afterId,
      remaining,
    );
    arrayFor(arrays, source.entityType).push(...rows.map((row) => row.payload));
    rowCount += rows.length;
    const last = rows.at(-1);
    if (rows.length < remaining || last === undefined) {
      // This entity is exhausted: on to the next one.
      remaining -= rows.length;
      rank += 1;
      afterId = 0;
    } else {
      // The page is full inside this entity.
      afterId = last.id;
      remaining = 0;
    }
  }

  const nextToken =
    rank < SYNC_ENTITY_SOURCES.length
      ? formatToken({ xmin: walk.xmin, rank, afterId })
      : null;
  return {
    kind: "page",
    syncCursor: formatSyncChangeCursor(
      { xid: walk.xmin, seq: 0n },
      syncScopeFingerprint(input.scope),
    ),
    nextToken,
    rowCount,
    arrays,
  };
}

/**
 * Whether a bootstrap request asks for pages: it states protocol 3 or later in its
 * body. A body that is absent or does not say so is a desktop of protocol 1 or 2.
 */
export function wantsBootstrapPages(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const protocolVersion: unknown = Object.fromEntries(
    Object.entries(body),
  ).protocolVersion;
  return (
    typeof protocolVersion === "number" &&
    protocolVersion >= SYNC_CHANGE_SEQ_PROTOCOL_VERSION
  );
}

/** The wire answer of one page, or null when the page token is not ours. */
export async function buildBootstrapPageResponse(input: {
  user: { id: string; name?: string | null; email?: string | null };
  member: MemberData;
  request: SyncBootstrapPageRequest;
}): Promise<SyncBootstrapPageResponse | null> {
  const { user, member } = input;
  const page = await loadBootstrapPage({
    scope: member,
    pageToken: input.request.pageToken,
    limit: input.request.limit ?? SYNC_BOOTSTRAP_DEFAULT_PAGE_SIZE,
  });
  if (page.kind === "invalid_token") return null;

  return syncBootstrapPageResponseSchema.parse({
    serverTime: new Date().toISOString(),
    user: {
      id: user.id,
      name: user.name ?? null,
      email: user.email ?? null,
    },
    organization: { id: member.organizationId, type: member.organizationType },
    activeUnits: member.accessibleUnits.map((unit) => ({
      id: unit.id,
      name: unit.name,
      role: unit.role ?? null,
    })),
    permissions: {
      role: member.role,
      unitRole: member.unitRole,
      activeUnitId: member.activeUnitId,
      accessibleUnitIds: member.accessibleUnitIds,
      canAccessAllUnits: member.canAccessAllUnits,
    },
    featureFlags: {
      offlineApprovals: false,
      offlineCertificatePublication: false,
    },
    syncCursor: page.syncCursor,
    ...page.arrays,
    page: { nextToken: page.nextToken, rowCount: page.rowCount },
  });
}
