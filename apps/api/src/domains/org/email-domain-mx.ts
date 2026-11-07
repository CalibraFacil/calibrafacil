import { promises as dns } from "node:dns";

/**
 * Does this domain actually receive e-mail?
 *
 * Self-serve sign-up requires the laboratory's own domain, and the cheapest
 * proof that a domain is real (rather than typed into a form five seconds ago)
 * is that it publishes MX records. A domain with none cannot receive the claim
 * link anyway, so accepting it would only create an orphan organization.
 *
 * Deliberately fail-OPEN on infrastructure trouble: a DNS timeout is our
 * problem, not the customer's, and refusing a paying lab because a resolver
 * blinked is worse than letting one bad domain through a check that is only
 * one of several. Fail-CLOSED only on an authoritative "this domain has no
 * mail exchanger".
 */
export type MxCheckResult = "has_mx" | "no_mx" | "unknown";

const LOOKUP_TIMEOUT_MS = 3000;

export async function checkDomainHasMx(domain: string): Promise<MxCheckResult> {
  if (!domain) return "no_mx";

  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("MX_LOOKUP_TIMEOUT")),
          LOOKUP_TIMEOUT_MS,
        ),
      ),
    ]);

    return records.length > 0 ? "has_mx" : "no_mx";
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";

    // NXDOMAIN / NODATA are authoritative answers: the domain does not exist,
    // or exists with no MX. Everything else (timeout, SERVFAIL, no resolver in
    // the runtime) is inconclusive.
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return "no_mx";
    }

    return "unknown";
  }
}
