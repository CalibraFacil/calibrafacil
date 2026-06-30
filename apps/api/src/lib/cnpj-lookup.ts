import { z } from "zod";
import {
  formatCnpj,
  isValidCnpj,
  normalizeCnpj,
} from "@calibra-facil/shared/cnpj";

/**
 * Server-side CNPJ registry lookup used to pre-fill the customer cadastro.
 *
 * Source of truth is the Receita Federal open-data dump, fetched through two free,
 * key-less mirrors: OpenCNPJ (primary — purpose-built, 50 req/s per IP, returns the raw
 * RFB strings verbatim) with BrasilAPI as fallback. Both return `razao_social` exactly as
 * registered (uppercase, no accents, with any "- EM RECUPERACAO JUDICIAL" suffix), which is
 * what we store as the canonical `customer.name`. `nome_fantasia` feeds the new trade name.
 *
 * The mapping functions are pure (and unit-tested); only `fetchCnpjRegistration` does I/O.
 */

export type CnpjAddress = {
  cep: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighbourhood: string | null;
  city: string | null;
  state: string | null;
};

export type CnpjLookupResult = {
  /** Formatted XX.XXX.XXX/XXXX-XX (letter-safe). */
  taxId: string;
  /** Razao social — the legal name, stored verbatim from the RFB. */
  name: string;
  /** Nome fantasia (trade name), when the RFB has one. */
  tradeName: string | null;
  email: string | null;
  phone: string | null;
  /** Situacao cadastral (e.g. "ATIVA"). Informational; not persisted today. */
  status: string | null;
  address: CnpjAddress;
};

export type CnpjLookupOutcome =
  | { status: "ok"; result: CnpjLookupResult }
  | { status: "not-found" }
  | { status: "invalid" }
  | { status: "error" };

const PROVIDER_TIMEOUT_MS = 4000;

function cleanText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

/** Collapse the RFB's padded multi-space fields ("LOTE  013     QUADRA066") to single spaces. */
function normalizeWhitespace(value: string | null | undefined): string | null {
  const collapsed = (value ?? "").replace(/\s+/g, " ").trim();
  return collapsed ? collapsed : null;
}

function joinStreet(
  type: string | null | undefined,
  street: string | null | undefined,
): string | null {
  const parts = [cleanText(type), cleanText(street)].filter(
    (part): part is string => part !== null,
  );
  return parts.length ? parts.join(" ") : null;
}

function formatCep(value: string | number | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 8) return digits ? digits : null;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function formatPhone(digits: string | null | undefined): string | null {
  const d = String(digits ?? "").replace(/\D/g, "");
  if (d.length < 10) return d ? d : null;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2, d.length === 10 ? 10 : 11);
  return rest.length === 9
    ? `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`
    : `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
}

// --- OpenCNPJ (primary) -----------------------------------------------------

const OpenCnpjSchema = z.looseObject({
  razao_social: z.string().optional(),
  nome_fantasia: z.string().optional(),
  situacao_cadastral: z.string().optional(),
  tipo_logradouro: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cep: z.string().optional(),
  uf: z.string().optional(),
  municipio: z.string().optional(),
  email: z.string().nullish(),
  telefones: z
    .array(
      z.looseObject({
        ddd: z.string().optional(),
        numero: z.string().optional(),
        is_fax: z.boolean().optional(),
      }),
    )
    .optional(),
});

export function mapOpenCnpj(
  raw: unknown,
  cnpj14: string,
): CnpjLookupResult | null {
  const parsed = OpenCnpjSchema.safeParse(raw);
  if (!parsed.success) return null;
  const data = parsed.data;
  const name = cleanText(data.razao_social);
  if (!name) return null;

  const phones = data.telefones ?? [];
  const voice = phones.find((phone) => !phone.is_fax) ?? phones[0];
  const phoneDigits = voice ? `${voice.ddd ?? ""}${voice.numero ?? ""}` : null;

  return {
    taxId: formatCnpj(cnpj14),
    name,
    tradeName: cleanText(data.nome_fantasia),
    email: cleanText(data.email),
    phone: formatPhone(phoneDigits),
    status: cleanText(data.situacao_cadastral),
    address: {
      cep: formatCep(data.cep),
      street: joinStreet(data.tipo_logradouro, data.logradouro),
      number: cleanText(data.numero),
      complement: normalizeWhitespace(data.complemento),
      neighbourhood: cleanText(data.bairro),
      city: cleanText(data.municipio),
      state: cleanText(data.uf),
    },
  };
}

// --- BrasilAPI (fallback) ---------------------------------------------------

const BrasilApiSchema = z.looseObject({
  razao_social: z.string().optional(),
  nome_fantasia: z.string().optional(),
  descricao_situacao_cadastral: z.string().optional(),
  descricao_tipo_de_logradouro: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cep: z.union([z.string(), z.number()]).optional(),
  uf: z.string().optional(),
  municipio: z.string().optional(),
  email: z.string().nullish(),
  ddd_telefone_1: z.string().optional(),
});

export function mapBrasilApi(
  raw: unknown,
  cnpj14: string,
): CnpjLookupResult | null {
  const parsed = BrasilApiSchema.safeParse(raw);
  if (!parsed.success) return null;
  const data = parsed.data;
  const name = cleanText(data.razao_social);
  if (!name) return null;

  return {
    taxId: formatCnpj(cnpj14),
    name,
    tradeName: cleanText(data.nome_fantasia),
    email: cleanText(data.email),
    phone: formatPhone(data.ddd_telefone_1),
    status: cleanText(data.descricao_situacao_cadastral),
    address: {
      cep: formatCep(data.cep),
      street: joinStreet(data.descricao_tipo_de_logradouro, data.logradouro),
      number: cleanText(data.numero),
      complement: normalizeWhitespace(data.complemento),
      neighbourhood: cleanText(data.bairro),
      city: cleanText(data.municipio),
      state: cleanText(data.uf),
    },
  };
}

// --- I/O --------------------------------------------------------------------

type ProviderOutcome =
  | { status: "ok"; result: CnpjLookupResult }
  | { status: "not-found" }
  | { status: "error" };

async function tryProvider(
  url: string,
  map: (raw: unknown) => CnpjLookupResult | null,
): Promise<ProviderOutcome> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (response.status === 404) return { status: "not-found" };
    if (!response.ok) return { status: "error" };
    const result = map(await response.json());
    return result ? { status: "ok", result } : { status: "not-found" };
  } catch {
    return { status: "error" };
  }
}

/**
 * Resolve a CNPJ against OpenCNPJ, falling back to BrasilAPI on a provider error.
 * A clean "not found" from either mirror is reported as not-found (no point retrying);
 * only transport/5xx errors cascade to the fallback.
 */
export async function fetchCnpjRegistration(
  rawCnpj: string,
): Promise<CnpjLookupOutcome> {
  const normalized = normalizeCnpj(rawCnpj);
  if (!isValidCnpj(normalized)) return { status: "invalid" };

  const primary = await tryProvider(
    `https://api.opencnpj.org/${normalized}`,
    (raw) => mapOpenCnpj(raw, normalized),
  );
  if (primary.status === "ok") return primary;

  const fallback = await tryProvider(
    `https://brasilapi.com.br/api/cnpj/v1/${normalized}`,
    (raw) => mapBrasilApi(raw, normalized),
  );
  if (fallback.status === "ok") return fallback;

  if (primary.status === "not-found" || fallback.status === "not-found") {
    return { status: "not-found" };
  }
  return { status: "error" };
}
