# Mini-spec: certificate-numbering pure helpers coverage

Target: `apps/api/src/lib/certificate-numbering.ts`
Test file: `apps/api/src/lib/__tests__/certificate-numbering.spec.ts` (Vitest `.spec.ts`)

## Context
Scope = the EXPORTED PURE functions only. The DB-coupled
`generateCertificateIdentity` (transactions, sequence reservation, collision loop)
is OUT OF SCOPE for this coverage pass (integration surface). Cert numbers appear on
issued certificates → assert exact strings.

In scope: `getUnsupportedCertificateTokens`, `validateCertificateNumberingConfig`,
`renderCertificateTemplate`, `buildCertificateSequenceKey`,
`DEFAULT_CERTIFICATE_NUMBERING_CONFIG`.

## Acceptance Criteria

- REQ-CERTNUM-001: WHEN `getUnsupportedCertificateTokens` scans a template, the
  function SHALL return the distinct `{token}` names not in the supported set
  (supported includes `number,labCode,labName,labSlug,projectCode,yyyy,yy,mm,mon,dd,seq`),
  and SHALL return `[]` when all tokens are supported.
- REQ-CERTNUM-002: WHEN `validateCertificateNumberingConfig` receives a config whose
  templates use only supported tokens AND the numberTemplate contains `{seq}`, the
  function SHALL return the config unchanged.
- REQ-CERTNUM-003: IF a template contains an unsupported token, THEN
  `validateCertificateNumberingConfig` SHALL throw an Error naming the unsupported
  token(s) (message starts `"Tokens nao suportados"`).
- REQ-CERTNUM-004: IF the numberTemplate omits `{seq}`, THEN
  `validateCertificateNumberingConfig` SHALL throw an Error
  (`"Formato do numero deve conter o token {seq}"`).
- REQ-CERTNUM-005: WHEN `renderCertificateTemplate` is given tokens, the function
  SHALL substitute every defined token and SHALL leave an unknown `{token}` literally
  unchanged in the output.
- REQ-CERTNUM-006: WHEN `buildCertificateSequenceKey` is called with each reset scope,
  the function SHALL return: `"global"` for `never`; `"year:<YYYY>"` for `year`;
  `"month:<YYYY>-<MM>"` (MM zero-padded) for `month`; `"project:<code>"` for `project`.
- REQ-CERTNUM-007: WHEN `buildCertificateSequenceKey` resolves a `project` scope with
  no context/config projectCode, the function SHALL fall back to `"project:GERAL"`;
  WHEN context.projectCode is set it SHALL take precedence over config.projectCode.
- REQ-CERTNUM-008: The `DEFAULT_CERTIFICATE_NUMBERING_CONFIG` SHALL have
  `numberTemplate === "{labCode}-{yyyy}-{seq}"`, `labCode === "CAL"`, and a `year`
  reset scope with padding 4 — and SHALL pass `validateCertificateNumberingConfig`.
