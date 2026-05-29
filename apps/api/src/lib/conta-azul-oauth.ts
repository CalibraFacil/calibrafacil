import { DEFAULT_CONTA_AZUL_SCOPES } from "@calibra-facil/shared";

export const CONTA_AZUL_AUTHORIZATION_URL = "https://auth.contaazul.com/login";

export const CONTA_AZUL_TOKEN_URL = "https://auth.contaazul.com/oauth2/token";

export interface ContaAzulOAuthEnv {
  CONTA_AZUL_CLIENT_ID?: string;
  CONTA_AZUL_CLIENT_SECRET?: string;
  CONTA_AZUL_OAUTH_REDIRECT_URI?: string;
  INTEGRATIONS_MASTER_KEY?: string;
}

export interface ContaAzulOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateSecret: string;
}

export interface ContaAzulOAuthStatePayload {
  organizationId: string;
  userId: string;
  sessionId: string;
  issuedAt: number;
  nonce: string;
  returnTo: string | null;
}

export interface ContaAzulTokenBundle {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: string;
  scopes: string[];
}

export function serializeContaAzulTokenBundle(bundle: ContaAzulTokenBundle) {
  return JSON.stringify(bundle);
}

export function parseContaAzulTokenBundle(value: string): ContaAzulTokenBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Credenciais OAuth da Conta Azul inválidas");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Credenciais OAuth da Conta Azul inválidas");
  }

  const record = Object.fromEntries(Object.entries(parsed));
  if (
    typeof record.accessToken !== "string" ||
    typeof record.refreshToken !== "string" ||
    typeof record.tokenType !== "string" ||
    typeof record.expiresIn !== "number" ||
    typeof record.expiresAt !== "string" ||
    !Array.isArray(record.scopes) ||
    record.scopes.some((scope) => typeof scope !== "string")
  ) {
    throw new Error("Credenciais OAuth da Conta Azul inválidas");
  }

  return {
    accessToken: record.accessToken,
    refreshToken: record.refreshToken,
    tokenType: record.tokenType,
    expiresIn: record.expiresIn,
    expiresAt: record.expiresAt,
    scopes: record.scopes,
  };
}

type TokenResponseBody = {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
};

type TokenRequestParams = {
  code: string;
  redirectUri?: string;
};

type RefreshRequestParams = {
  refreshToken: string;
};

export class ContaAzulOAuthError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly description: string | null;

  constructor(params: {
    status: number;
    code?: string | null;
    description?: string | null;
  }) {
    const suffix = params.code ? ` (${params.code})` : "";
    super(`Conta Azul OAuth respondeu ${params.status}${suffix}`);
    this.name = "ContaAzulOAuthError";
    this.status = params.status;
    this.code = params.code ?? null;
    this.description = params.description ?? null;
  }
}

export function isContaAzulInvalidGrantError(error: unknown) {
  return error instanceof ContaAzulOAuthError && error.code === "invalid_grant";
}

export type ContaAzulRefreshFailureReason =
  | "invalid_grant"
  | "refresh_failed";

export interface ContaAzulRefreshFailurePolicy {
  status: "ACTION_REQUIRED";
  message: string;
  reason: ContaAzulRefreshFailureReason;
}

export function buildContaAzulRefreshFailurePolicy(
  error: unknown,
): ContaAzulRefreshFailurePolicy {
  if (isContaAzulInvalidGrantError(error)) {
    return {
      status: "ACTION_REQUIRED",
      message:
        "Conta Azul revogou ou expirou o refresh token. Reconecte a integração.",
      reason: "invalid_grant",
    };
  }

  return {
    status: "ACTION_REQUIRED",
    message:
      "Falha ao renovar token OAuth da Conta Azul. Reconecte a integração.",
    reason: "refresh_failed",
  };
}

const STATE_VERSION = "v1";
const STATE_TTL_MS = 10 * 60 * 1000;

function requireEnvValue(
  name: keyof ContaAzulOAuthEnv,
  value: string | undefined,
) {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${name} não configurado`);
  }

  return trimmed;
}

export function getContaAzulOAuthConfig(
  env: ContaAzulOAuthEnv,
): ContaAzulOAuthConfig {
  return {
    clientId: requireEnvValue("CONTA_AZUL_CLIENT_ID", env.CONTA_AZUL_CLIENT_ID),
    clientSecret: requireEnvValue(
      "CONTA_AZUL_CLIENT_SECRET",
      env.CONTA_AZUL_CLIENT_SECRET,
    ),
    redirectUri: requireEnvValue(
      "CONTA_AZUL_OAUTH_REDIRECT_URI",
      env.CONTA_AZUL_OAUTH_REDIRECT_URI,
    ),
    stateSecret: requireEnvValue(
      "INTEGRATIONS_MASTER_KEY",
      env.INTEGRATIONS_MASTER_KEY,
    ),
  };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson(value: string): unknown {
  const decoded = new TextDecoder().decode(base64UrlDecode(value));
  return JSON.parse(decoded);
}

async function importHmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signStatePayload(
  payload: string,
  secret: string,
): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );

  return base64UrlEncode(new Uint8Array(signature));
}

async function verifyStateSignature(params: {
  payload: string;
  signature: string;
  secret: string;
}) {
  const key = await importHmacKey(params.secret);
  return crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(params.signature),
    new TextEncoder().encode(params.payload),
  );
}

function isStatePayload(value: unknown): value is ContaAzulOAuthStatePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = Object.fromEntries(Object.entries(value));
  return (
    typeof record.organizationId === "string" &&
    typeof record.userId === "string" &&
    typeof record.sessionId === "string" &&
    typeof record.issuedAt === "number" &&
    typeof record.nonce === "string" &&
    (record.returnTo === null || typeof record.returnTo === "string")
  );
}

function randomStateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function createContaAzulOAuthState(params: {
  organizationId: string;
  userId: string;
  sessionId: string;
  stateSecret: string;
  returnTo?: string | null;
  now?: Date;
}): Promise<string> {
  const payload: ContaAzulOAuthStatePayload = {
    organizationId: params.organizationId,
    userId: params.userId,
    sessionId: params.sessionId,
    issuedAt: (params.now ?? new Date()).getTime(),
    nonce: randomStateNonce(),
    returnTo: params.returnTo ?? null,
  };
  const encodedPayload = encodeJson({
    version: STATE_VERSION,
    payload,
  });
  const signature = await signStatePayload(encodedPayload, params.stateSecret);

  return `${encodedPayload}.${signature}`;
}

export async function verifyContaAzulOAuthState(params: {
  state: string;
  stateSecret: string;
  expectedOrganizationId?: string;
  expectedUserId?: string;
  expectedSessionId?: string;
  now?: Date;
}): Promise<ContaAzulOAuthStatePayload> {
  const [payloadPart, signaturePart] = params.state.split(".");
  if (!payloadPart || !signaturePart) {
    throw new Error("Estado OAuth inválido");
  }

  const signatureValid = await verifyStateSignature({
    payload: payloadPart,
    signature: signaturePart,
    secret: params.stateSecret,
  });
  if (!signatureValid) {
    throw new Error("Estado OAuth inválido");
  }

  const decoded = decodeJson(payloadPart);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("Estado OAuth inválido");
  }

  const envelope = Object.fromEntries(Object.entries(decoded));
  if (envelope.version !== STATE_VERSION || !isStatePayload(envelope.payload)) {
    throw new Error("Estado OAuth inválido");
  }

  const payload = envelope.payload;
  if (
    (params.expectedOrganizationId !== undefined &&
      payload.organizationId !== params.expectedOrganizationId) ||
    (params.expectedUserId !== undefined &&
      payload.userId !== params.expectedUserId) ||
    (params.expectedSessionId !== undefined &&
      payload.sessionId !== params.expectedSessionId)
  ) {
    throw new Error("Estado OAuth não corresponde à sessão atual");
  }

  const now = params.now ?? new Date();
  const ageMs = now.getTime() - payload.issuedAt;
  if (ageMs < 0 || ageMs > STATE_TTL_MS) {
    throw new Error("Estado OAuth expirado");
  }

  return payload;
}

export async function buildContaAzulAuthorizationUrl(params: {
  config: ContaAzulOAuthConfig;
  organizationId: string;
  userId: string;
  sessionId: string;
  returnTo?: string | null;
  now?: Date;
}) {
  const state = await createContaAzulOAuthState({
    organizationId: params.organizationId,
    userId: params.userId,
    sessionId: params.sessionId,
    stateSecret: params.config.stateSecret,
    returnTo: params.returnTo,
    now: params.now,
  });
  const url = new URL(CONTA_AZUL_AUTHORIZATION_URL);

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.config.clientId);
  url.searchParams.set("redirect_uri", params.config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", DEFAULT_CONTA_AZUL_SCOPES.join(" "));

  return {
    url: url.toString(),
    state,
  };
}

function buildBasicAuthorizationHeader(config: ContaAzulOAuthConfig) {
  return `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getOAuthErrorCode(body: unknown) {
  if (!isRecord(body) || typeof body.error !== "string") {
    return null;
  }

  return body.error.trim() || null;
}

function getOAuthErrorDescription(body: unknown) {
  if (!isRecord(body) || typeof body.error_description !== "string") {
    return null;
  }

  return body.error_description.trim() || null;
}

function parseTokenResponse(
  body: TokenResponseBody,
  now: Date,
): ContaAzulTokenBundle {
  if (
    typeof body.access_token !== "string" ||
    typeof body.refresh_token !== "string"
  ) {
    throw new Error("Resposta OAuth da Conta Azul não contém tokens válidos");
  }

  const expiresIn =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
      ? Math.trunc(body.expires_in)
      : 3600;
  const scopes =
    typeof body.scope === "string" && body.scope.trim()
      ? body.scope.trim().split(/\s+/)
      : [...DEFAULT_CONTA_AZUL_SCOPES];

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    tokenType: typeof body.token_type === "string" ? body.token_type : "Bearer",
    expiresIn,
    expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
    scopes,
  };
}

async function requestContaAzulToken(params: {
  config: ContaAzulOAuthConfig;
  body: URLSearchParams;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<ContaAzulTokenBundle> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(CONTA_AZUL_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: buildBasicAuthorizationHeader(params.config),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.body,
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ContaAzulOAuthError({
      status: response.status,
      code: getOAuthErrorCode(body),
      description: getOAuthErrorDescription(body),
    });
  }

  return parseTokenResponse(
    isRecord(body) ? body : {},
    params.now ?? new Date(),
  );
}

export function exchangeContaAzulAuthorizationCode(
  config: ContaAzulOAuthConfig,
  params: TokenRequestParams & {
    fetchImpl?: typeof fetch;
    now?: Date;
  },
) {
  const body = new URLSearchParams();
  body.set("code", params.code);
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", params.redirectUri ?? config.redirectUri);

  return requestContaAzulToken({
    config,
    body,
    fetchImpl: params.fetchImpl,
    now: params.now,
  });
}

export function refreshContaAzulAccessToken(
  config: ContaAzulOAuthConfig,
  params: RefreshRequestParams & {
    fetchImpl?: typeof fetch;
    now?: Date;
  },
) {
  const body = new URLSearchParams();
  body.set("refresh_token", params.refreshToken);
  body.set("grant_type", "refresh_token");

  return requestContaAzulToken({
    config,
    body,
    fetchImpl: params.fetchImpl,
    now: params.now,
  });
}
