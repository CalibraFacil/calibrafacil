import {
  createRatchet,
  isTestFile,
  normalizedFilename,
  type Baseline,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";

// Domain failures in apps/api/src/routes must be thrown as DomainErrors
// (apps/api/src/lib/domain-errors.ts) so every client gets a stable `code`,
// instead of hand-built `c.json({ error: "<texto>" }, status)` bodies.
// Convention: docs/architecture/api-client-contract.md.
//
// ~1000 legacy sites predate the convention. They are grandfathered as exact
// per-file counts (LEGACY_BASELINE, same ratchet as the other calibra rules):
// a file may never gain one, and a migrated site should lower its file's
// count in the same change. An unlisted file must have zero.

const ROUTES_PATTERN = /(^|\/)apps\/api\/src\/routes\//;

const LEGACY_BASELINE: Baseline = new Map<string, number>([
  ["apps/api/src/routes/accredited-scope.ts", 4],
  ["apps/api/src/routes/api-keys.ts", 2],
  ["apps/api/src/routes/asset-types.ts", 4],
  ["apps/api/src/routes/assets.ts", 34],
  ["apps/api/src/routes/authorized-signatories.ts", 3],
  ["apps/api/src/routes/calibration-requests.ts", 11],
  ["apps/api/src/routes/capa.ts", 20],
  ["apps/api/src/routes/certificate-numbering.ts", 2],
  ["apps/api/src/routes/competences.ts", 34],
  ["apps/api/src/routes/customer-groups.ts", 42],
  ["apps/api/src/routes/customers.ts", 57],
  ["apps/api/src/routes/dashboard.ts", 1],
  ["apps/api/src/routes/email-domains.ts", 7],
  ["apps/api/src/routes/environmental-limits.ts", 3],
  ["apps/api/src/routes/finance/automatic-send.ts", 6],
  ["apps/api/src/routes/finance/certificate-release.ts", 13],
  ["apps/api/src/routes/finance/contracts.ts", 13],
  ["apps/api/src/routes/finance/documents.ts", 20],
  ["apps/api/src/routes/finance/erp.ts", 4],
  ["apps/api/src/routes/finance/receipts.ts", 5],
  ["apps/api/src/routes/finance/timeline.ts", 5],
  ["apps/api/src/routes/integrations.ts", 45],
  ["apps/api/src/routes/invitations.ts", 6],
  ["apps/api/src/routes/jobs.ts", 79],
  ["apps/api/src/routes/lab-setup.ts", 6],
  ["apps/api/src/routes/legal-metrology-regulations.ts", 1],
  ["apps/api/src/routes/materials.ts", 13],
  ["apps/api/src/routes/methods.ts", 74],
  ["apps/api/src/routes/non-conformances.ts", 38],
  ["apps/api/src/routes/notifications.ts", 4],
  ["apps/api/src/routes/organization-media.ts", 9],
  ["apps/api/src/routes/portal-domains.ts", 6],
  ["apps/api/src/routes/portal-notifications.ts", 4],
  ["apps/api/src/routes/portal-requests.ts", 10],
  ["apps/api/src/routes/portal-visits.ts", 11],
  ["apps/api/src/routes/portal.ts", 96],
  ["apps/api/src/routes/proficiency-tests.ts", 17],
  ["apps/api/src/routes/profile-media.ts", 7],
  ["apps/api/src/routes/public-api.ts", 3],
  ["apps/api/src/routes/public-signup.ts", 8],
  ["apps/api/src/routes/reports.ts", 9],
  ["apps/api/src/routes/service-orders.ts", 89],
  ["apps/api/src/routes/services.ts", 16],
  ["apps/api/src/routes/sessions.ts", 3],
  ["apps/api/src/routes/signatures.ts", 12],
  ["apps/api/src/routes/signing.ts", 16],
  ["apps/api/src/routes/spc.ts", 19],
  ["apps/api/src/routes/sso.ts", 11],
  ["apps/api/src/routes/standards.ts", 43],
  ["apps/api/src/routes/sync/attachments.ts", 3],
  ["apps/api/src/routes/training-records.ts", 12],
  ["apps/api/src/routes/units.ts", 18],
  ["apps/api/src/routes/verify.ts", 13],
  ["apps/api/src/routes/visits.ts", 40],
  ["apps/api/src/routes/webhooks.ts", 3],
]);

const MESSAGE =
  'Do not build a domain failure by hand with c.json({ error }, status). Throw a DomainError (notFound/invalid/conflict/... from apps/api/src/lib/domain-errors.ts) with a code from @calibra-facil/contracts so clients get a stable "code". See docs/architecture/api-client-contract.md.';

type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? Object(value) : null;
}

function isJsonCallee(callee: UnknownRecord | null): boolean {
  if (callee?.type !== "MemberExpression" || callee.computed === true) {
    return false;
  }
  return toRecord(callee.property)?.name === "json";
}

function keyName(property: UnknownRecord): string | null {
  if (property.type !== "Property") return null;
  const key = toRecord(property.key);
  if (typeof key?.name === "string") return key.name;
  if (typeof key?.value === "string") return key.value;
  return null;
}

/** `<anything>.json({ error: ..., ... }, ...)` — first argument carries `error`. */
function isJsonErrorBodyCall(node: unknown): boolean {
  const call = toRecord(node);
  if (!call || !isJsonCallee(toRecord(call.callee))) return false;
  const args = call.arguments;
  if (!Array.isArray(args)) return false;
  const body = toRecord(args[0]);
  if (body?.type !== "ObjectExpression" || !Array.isArray(body.properties)) {
    return false;
  }
  return body.properties.some((property) => {
    const record = toRecord(property);
    return record !== null && keyName(record) === "error";
  });
}

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow c.json({ error }) domain-failure bodies in API routes; throw a DomainError instead.",
    },
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    if (!ROUTES_PATTERN.test(filename) || isTestFile(filename)) return {};

    const ratchet = createRatchet(LEGACY_BASELINE, filename);
    return {
      CallExpression(node: unknown) {
        if (!isJsonErrorBodyCall(node)) return;
        if (!ratchet.exceeds()) return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
};

export default rule;
