// Live contract test against the Conta Azul developer sandbox.
//
// This suite is OPT-IN. It is skipped unless the runner's process.env carries
// either:
//   - CONTA_AZUL_TEST_ACCESS_TOKEN — a pre-minted short-lived access token,
//     used directly with NO token refresh. This is the non-destructive mode:
//     it never rotates a stored refresh token, so it won't desync a live app
//     connection. Best for running against a freshly-connected dev account.
//   OR all three of:
//   - CONTA_AZUL_TEST_REFRESH_TOKEN  (minted once via the app's OAuth flow
//     against the ERP test account — Conta Azul has no client_credentials grant)
//   - CONTA_AZUL_CLIENT_ID
//   - CONTA_AZUL_CLIENT_SECRET
//     This mode also validates the refresh_token grant, but Conta Azul ROTATES
//     the refresh token on every refresh — do not reuse a token the app relies
//     on, or you will desync it.
//
// The normal `turbo test` run does NOT load apps/api/.env, so this never fires
// in CI by accident. To run it locally:
//
//   CONTA_AZUL_CLIENT_ID=... \
//   CONTA_AZUL_CLIENT_SECRET=... \
//   CONTA_AZUL_TEST_REFRESH_TOKEN=... \
//   pnpm --filter @calibra-facil/api test:run \
//     src/lib/__tests__/conta-azul-contract.live.spec.ts
//
// Its purpose is to convert the "dev-observed" undocumented endpoints
// (/v1/protocolo/{id} and the parcela/baixa acquittance surface, which are NOT
// in any public OpenAPI spec) into test-verified contracts, and to confirm the
// documented shapes the adapter relies on. It WRITES throwaway data to the test
// ERP (one tiny receivable event + acquittance) and cleans up the acquittance
// afterwards; the receivable event is left in the disposable test account
// because Conta Azul exposes no delete for it.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ContaAzulClient,
  type ContaAzulInstallment,
  type ContaAzulProtocolResponse,
  type ContaAzulProtocolStatusResponse,
  type ContaAzulReceivableEventCreate,
} from "../conta-azul-client";
import { refreshContaAzulAccessToken } from "../conta-azul-oauth";

const accessTokenEnv = process.env.CONTA_AZUL_TEST_ACCESS_TOKEN?.trim();
const refreshToken = process.env.CONTA_AZUL_TEST_REFRESH_TOKEN?.trim();
const clientId = process.env.CONTA_AZUL_CLIENT_ID?.trim();
const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET?.trim();
const LIVE = Boolean(
  accessTokenEnv || (refreshToken && clientId && clientSecret),
);

function requireString(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required to run the Conta Azul contract test`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

// Reference/search endpoints return either {items}, {itens} or a bare array.
function extractItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.itens)) return record.itens;
  return [];
}

function extractId(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ["id", "uuid", "id_categoria", "id_conta_financeira"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function firstItemId(value: unknown): string | null {
  for (const item of extractItems(value)) {
    const id = extractId(item);
    if (id) return id;
  }
  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

// Dump raw JSON so the run output itself records the real shape of the
// undocumented endpoints (this is the artifact we're after).
function logRaw(label: string, value: unknown) {
  console.info(`[conta-azul-contract] ${label}: ${JSON.stringify(value)}`);
}

describe.skipIf(!LIVE)("Conta Azul live contract (sandbox)", () => {
  let client: ContaAzulClient;
  let createdAcquittanceId: string | null = null;

  beforeAll(async () => {
    let accessToken: string;

    if (accessTokenEnv) {
      // Non-destructive mode: use a pre-minted access token directly. No
      // refresh, so no refresh-token rotation and no risk of desyncing a live
      // app connection.
      accessToken = accessTokenEnv;
    } else {
      // Refresh mode: also validates the refresh_token grant. Conta Azul
      // rotates the refresh token here, so only use a throwaway one.
      const bundle = await refreshContaAzulAccessToken(
        {
          clientId: requireString(clientId, "CONTA_AZUL_CLIENT_ID"),
          clientSecret: requireString(clientSecret, "CONTA_AZUL_CLIENT_SECRET"),
          // Unused by the refresh_token grant (not sent in the body), but the
          // config type requires them.
          redirectUri: "https://unused.local/callback",
          stateSecret: "unused",
        },
        {
          refreshToken: requireString(
            refreshToken,
            "CONTA_AZUL_TEST_REFRESH_TOKEN",
          ),
        },
      );

      expect(typeof bundle.accessToken).toBe("string");
      expect(bundle.accessToken.length).toBeGreaterThan(0);
      expect(typeof bundle.refreshToken).toBe("string");
      expect(bundle.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      accessToken = bundle.accessToken;
    }

    client = new ContaAzulClient({
      accessToken,
      rateLimitKey: "conta-azul-contract-test",
    });
  }, 30_000);

  afterAll(async () => {
    if (createdAcquittanceId && client) {
      // Best-effort cleanup of the throwaway acquittance.
      try {
        await client.deleteAcquittance(createdAcquittanceId);
      } catch (error) {
        logRaw("cleanup deleteAcquittance failed", String(error));
      }
    }
  });

  it("refreshes the token and reads documented reference endpoints", async () => {
    const accounts = await client.listFinancialAccounts();
    const categories = await client.listCategories();
    logRaw("listFinancialAccounts", accounts);
    logRaw("listCategories", categories);

    // Both endpoints must return the documented {itens|items: [...]} envelope.
    // categories is the default chart of accounts, always populated; financial
    // accounts may legitimately be empty on a freshly-provisioned account, so
    // assert shape (an array), not non-emptiness.
    expect(Array.isArray(extractItems(accounts))).toBe(true);
    expect(extractItems(categories).length).toBeGreaterThan(0);
  }, 30_000);

  it("exercises the undocumented protocol + acquittance flow end-to-end", async (ctx) => {
    // --- Resolve reference data needed to build a receivable event ---
    const accountId = firstItemId(await client.listFinancialAccounts());
    const categoryId = firstItemId(await client.listCategories());

    // A financial account (conta financeira) is mandatory to create a
    // receivable event, and it can only be created in the ERP UI. Skip
    // (rather than fail) when the test account hasn't been set up — this is
    // an account-provisioning gap, not a contract violation.
    if (!accountId) {
      ctx.skip(
        "test account has no financial account (conta financeira); create one in the ERP to exercise the protocol/baixa flow",
      );
      return;
    }

    let contatoId = firstItemId(
      await client.searchPessoas({ tamanho_pagina: 10, pagina: 1 }),
    );

    if (!contatoId) {
      const created = await client.createPessoa({
        ativo: true,
        nome: "Contrato Teste CalibraFácil",
        tipo_pessoa: "Jurídica",
        cnpj: "11222333000181",
        perfis: [{ tipo_perfil: "Cliente" }],
      });
      logRaw("createPessoa", created);
      contatoId = extractId(created);
    }

    expect(categoryId, "test account needs a category").toBeTruthy();
    expect(contatoId, "could not resolve/create a customer").toBeTruthy();
    if (!categoryId || !contatoId) return;

    // --- Create a tiny receivable event (async → 202 + protocolId) ---
    const event: ContaAzulReceivableEventCreate = {
      data_competencia: today(),
      valor: 1.23,
      observacao: "Contract test (CalibraFácil) — safe to delete",
      descricao: "CF contract test receivable",
      contato: contatoId,
      conta_financeira: accountId,
      rateio: [{ id_categoria: categoryId, valor: 1.23 }],
      condicao_pagamento: {
        parcelas: [
          {
            descricao: "Parcela 1",
            data_vencimento: inDays(7),
            nota: "",
            conta_financeira: accountId,
            // valor_liquido is required by the live API (the TS type marks it
            // optional, but Conta Azul rejects the create without it). The
            // real adapter sets both — mirror that here.
            detalhe_valor: { valor_bruto: 1.23, valor_liquido: 1.23 },
          },
        ],
      },
    };

    const protocol =
      await client.createReceivableEvent<ContaAzulProtocolResponse>(event);
    logRaw("createReceivableEvent → protocol", protocol);
    // Live API returns `protocolo`; older assumption was `protocolId`.
    const protocolId = protocol.protocolo ?? protocol.protocolId ?? "";
    expect(protocolId.length).toBeGreaterThan(0);

    // --- Poll the undocumented /v1/protocolo/{id} until it settles ---
    let status: ContaAzulProtocolStatusResponse | undefined;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      status = await client.getProtocol(protocolId);
      if (status.status && status.status !== "PENDING") break;
      await sleep(2_000);
    }
    logRaw("getProtocol (final)", status);
    expect(status, "protocol never returned").toBeTruthy();
    // evento_financeiro_id is the field the adapter relies on to link back.
    const eventoFinanceiroId =
      typeof status?.evento_financeiro_id === "string"
        ? status.evento_financeiro_id
        : null;
    expect(
      eventoFinanceiroId,
      "protocol did not yield evento_financeiro_id",
    ).toBeTruthy();
    if (!eventoFinanceiroId) return;

    // --- Validate installment shape via the documented installments call ---
    const installments =
      await client.getInstallmentsByEventId<ContaAzulInstallment[]>(
        eventoFinanceiroId,
      );
    logRaw("getInstallmentsByEventId", installments);
    expect(Array.isArray(installments)).toBe(true);
    const installment = installments[0];
    expect(installment, "event produced no installment").toBeTruthy();
    if (!installment) return;
    expect(typeof installment.id).toBe("string");
    expect(typeof installment.status).toBe("string");

    // --- Create an acquittance (baixa) on the undocumented surface ---
    const acquittance = await client.createAcquittance(installment.id, {
      data_pagamento: today(),
      composicao_valor: { valor_bruto: 1.23 },
      conta_financeira: accountId,
      metodo_pagamento: "PIX_COBRANCA",
      observacao: "Contract test acquittance — safe to delete",
    });
    logRaw("createAcquittance", acquittance);
    createdAcquittanceId = extractId(acquittance);

    // List acquittances back to confirm the round-trip shape.
    const acquittances = await client.listInstallmentAcquittances(
      installment.id,
    );
    logRaw("listInstallmentAcquittances", acquittances);
    expect(extractItems(acquittances).length).toBeGreaterThan(0);
  }, 120_000);
});
