import { computeCnpjCheckDigits, formatCnpj } from "@calibra-facil/shared/cnpj";

/**
 * Builds a structurally valid CNPJ (correct módulo-11 check digits) from an
 * 8-digit company root and a branch number. The roots used by the seed are
 * invented; a generated number can coincide with a real company by chance, which
 * is why the demo e-mails and sites live on reserved `.example`/`.test` domains.
 */
export function makeCnpj(root: string, branch = "0001"): string {
  if (!/^\d{8}$/.test(root)) throw new Error("CNPJ root must be 8 digits");
  if (!/^\d{4}$/.test(branch)) throw new Error("CNPJ branch must be 4 digits");
  const base = `${root}${branch}`;
  return formatCnpj(`${base}${computeCnpjCheckDigits(base)}`);
}
