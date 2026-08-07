/**
 * The one switch that disables certificate issuance while the certificate
 * layout is being replaced (#865).
 *
 * Background: certificates used to render from an XLSX workbook authored by
 * each lab. That path is gone — in production it served exactly one template,
 * belonging to our own lab, and issued one certificate in the product's whole
 * history. The fixed system layouts that replace it are not built yet, so
 * right now nothing can render a certificate.
 *
 * Approval therefore has to block. This preserves the invariant the old
 * per-method template gate enforced: never let a job leave REVIEW into a
 * pipeline that cannot produce a certificate, because the worker would fail
 * afterwards and strand it in GENERATING_PDF. Blocking early is honest and
 * reversible; approving into a dead pipeline is neither.
 *
 * DELETE THIS MODULE in Phase 3, once the worker renders the fixed layouts.
 * Deleting it breaks every call site at compile time, which is deliberate —
 * that is how we guarantee the block cannot be left behind by accident.
 */

/**
 * Machine-readable code for the dashboard API, which spells its codes
 * SCREAMING_SNAKE (SCOPE_VIOLATION, SELF_APPROVAL_BLOCKED, ...).
 */
export const CERTIFICATE_ISSUANCE_UNAVAILABLE_CODE =
  "CERTIFICATE_ISSUANCE_UNAVAILABLE";

/**
 * Same condition, spelled for the public v2 API, whose codes are all
 * lower_snake (asset_not_found, certificate_not_ready, ...). It replaces
 * `certificate_template_required` there, so an integrator matching on `code`
 * keeps getting a value in the shape the rest of that contract uses.
 */
export const CERTIFICATE_ISSUANCE_UNAVAILABLE_PUBLIC_CODE =
  "certificate_issuance_unavailable";

/** Operator-facing pt-BR explanation. Says what is happening, not "erro". */
export const CERTIFICATE_ISSUANCE_UNAVAILABLE_MESSAGE =
  "Emissão de certificado indisponível: o layout do certificado está em " +
  "redesenho e nenhum certificado pode ser emitido no momento. As calibrações " +
  "podem ser registradas e revisadas normalmente; a aprovação volta a " +
  "funcionar quando o novo layout entrar.";

/**
 * Always false during the redesign. Kept as a function (rather than a bare
 * `false`) so call sites read as a real guard and so Phase 3 can flip it to a
 * real check — layout resolvable for this method's quantity — before the
 * module is finally removed.
 */
export function isCertificateIssuanceAvailable(): boolean {
  return false;
}
