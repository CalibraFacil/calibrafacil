import { db } from "@calibra-facil/db";
import { organization } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";

import { LAB_ID } from "./api";

/**
 * Fills in the laboratory identity the certificates, the lab settings page and
 * the e-mail footers print. Plain column writes: the seed script created the
 * organization row without a profile.
 */
export async function seedLabProfile(): Promise<void> {
  await db
    .update(organization)
    .set({
      street: "Rua das Calibrações",
      number: "1250",
      complement: "Bloco B, sala 3",
      neighbourhood: "Centro Cívico",
      city: "Curitiba",
      state: "PR",
      cep: "80530-000",
      phone: "(41) 3000-1250",
      email: "contato@laboratorio.test",
      website: "https://laboratorio.test",
      technicalManagerName: "Rui Revisor",
      technicalManagerTitle: "Gerente Técnico",
    })
    .where(eq(organization.id, LAB_ID));
}
