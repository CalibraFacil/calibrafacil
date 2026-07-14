import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  PublicServiceOrderAccessViewSchema,
  RedeemServiceOrderAccessCodeResponseSchema,
} from "@calibra-facil/schemas";
import type { PublicServiceOrderAccessView } from "@calibra-facil/schemas";

import { getApiBaseUrl } from "@/lib/utils";

/**
 * Public quote-access transport (spec quote-approval-public-access, mini-spec E).
 *
 * Talks to the unauthenticated `/api/public/service-order-access/*` endpoints —
 * the token/code IS the credential, no session cookie. Responses are parsed
 * through Zod schemas from @calibra-facil/schemas (REQ-QPUB-045; no `as`
 * casts), and every terminal server state is returned AS DATA (discriminated
 * unions), not thrown — a 410 "orçamento respondido" must render a friendly
 * state, never retry-loop or toast an error.
 */

const viewEnvelopeSchema = z.object({
  data: PublicServiceOrderAccessViewSchema,
});

export type PublicOrderResult =
  | { kind: "ok"; order: PublicServiceOrderAccessView }
  /** 410 — the quote was already approved/rejected; the link answered its purpose. */
  | { kind: "responded" }
  /** 404 or malformed body — expired, revoked, or plain wrong link. */
  | { kind: "invalid" };

export async function fetchPublicServiceOrder(
  token: string,
): Promise<PublicOrderResult> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/public/service-order-access/${token}`,
  );
  if (response.status === 410) return { kind: "responded" };
  if (!response.ok) return { kind: "invalid" };
  const parsed = viewEnvelopeSchema.safeParse(await response.json());
  if (!parsed.success) return { kind: "invalid" };
  return { kind: "ok", order: parsed.data.data };
}

export function usePublicServiceOrder(token: string) {
  return useQuery({
    queryKey: ["public-service-order", token],
    queryFn: () => fetchPublicServiceOrder(token),
    // REQ-QPUB-043: after a decision the token is revoked — a background
    // refetch would 410 and blank the page. The snapshot is the source of
    // truth for the terminal confirmation.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export type RedeemResult =
  | { kind: "ok"; token: string }
  | { kind: "invalid" }
  | { kind: "throttled" };

export async function redeemAccessCode(code: string): Promise<RedeemResult> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/public/service-order-access/redeem-code`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    },
  );
  if (response.status === 429) return { kind: "throttled" };
  if (!response.ok) return { kind: "invalid" };
  const parsed = RedeemServiceOrderAccessCodeResponseSchema.safeParse(
    await response.json(),
  );
  if (!parsed.success) return { kind: "invalid" };
  return { kind: "ok", token: parsed.data.data.token };
}

export type QuoteDecision = "approved" | "rejected";

/**
 * Approve or reject through the public token. Resolves to true on success;
 * throws with the pt-BR message on failure (used by useMutation onError).
 */
export async function submitQuoteDecision(params: {
  token: string;
  decision: QuoteDecision;
  rejectionReason?: string;
}): Promise<QuoteDecision> {
  const path =
    params.decision === "approved" ? "approve-quote" : "reject-quote";
  const response = await fetch(
    `${getApiBaseUrl()}/api/public/service-order-access/${params.token}/${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        params.decision === "rejected"
          ? { rejectionReason: params.rejectionReason ?? null }
          : {},
      ),
    },
  );
  if (!response.ok) {
    throw new Error(
      params.decision === "approved"
        ? "Falha ao aprovar orçamento."
        : "Falha ao recusar orçamento.",
    );
  }
  return params.decision;
}
