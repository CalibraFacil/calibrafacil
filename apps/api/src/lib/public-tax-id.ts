/**
 * What the public certificate verification shows of the signer's tax id
 * (roadmap 2 D3, review 3.3; LGPD art. 6 III, necessity).
 *
 * A CPF identifies a person: only its middle six digits are shown
 * (`***.456.789-**`), enough to tell signers apart, not enough to reuse. A CNPJ
 * identifies a company and is public in the federal register, so it is shown as
 * recorded. Anything else is hidden.
 */
export function publicTaxId(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) {
    return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  }
  if (digits.length === 14) return value;
  return null;
}

/** A signature verdict with the signer's tax id reduced to its public form. */
export function withPublicSigner<
  T extends { signer?: { cpfCnpj: string | null } | null },
>(verdict: T): T {
  if (!verdict.signer) return verdict;
  return {
    ...verdict,
    signer: { ...verdict.signer, cpfCnpj: publicTaxId(verdict.signer.cpfCnpj) },
  };
}
