import { db } from "@calibra-facil/db";
import { customer } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";

import { LAB_ID, numberField } from "./api";
import { makeCnpj } from "./cnpj";
import type { SeedContext } from "./context";

export type DemoCustomer = {
  /** Short code used in instrument tags. */
  code: string;
  name: string;
  tradeName: string;
  cnpjRoot: string;
  email: string;
  phone: string;
  address: {
    cep: string;
    street: string;
    number: string;
    complement?: string;
    neighbourhood: string;
    city: string;
    state: string;
  };
  /** Relative share of the instrument park (and of the calibration volume). */
  weight: number;
};

/** Invented companies; e-mails live on the reserved `.example` TLD. */
export const DEMO_CUSTOMERS: readonly DemoCustomer[] = [
  {
    code: "LCB",
    name: "Laticínios Coxilha Branca Ltda",
    tradeName: "Coxilha Branca",
    cnpjRoot: "31406217",
    email: "qualidade@coxilhabranca.example",
    phone: "(41) 3322-1840",
    address: {
      cep: "83040-170",
      street: "Rodovia do Café",
      number: "4800",
      neighbourhood: "Distrito Industrial",
      city: "São José dos Pinhais",
      state: "PR",
    },
    weight: 26,
  },
  {
    code: "MHA",
    name: "Metalúrgica Horizonte Azul S.A.",
    tradeName: "Horizonte Azul",
    cnpjRoot: "44718903",
    email: "metrologia@horizonteazul.example",
    phone: "(47) 3431-7712",
    address: {
      cep: "89219-510",
      street: "Rua Ferreira de Andrade",
      number: "915",
      complement: "Galpão 2",
      neighbourhood: "Boa Vista",
      city: "Joinville",
      state: "SC",
    },
    weight: 22,
  },
  {
    code: "LES",
    name: "Laboratório Clínico Estrela do Sul Ltda",
    tradeName: "Estrela do Sul Análises Clínicas",
    cnpjRoot: "52093841",
    email: "controle@estreladosul.example",
    phone: "(19) 3255-0934",
    address: {
      cep: "13015-130",
      street: "Avenida Anchieta",
      number: "372",
      complement: "Conjunto 41",
      neighbourhood: "Centro",
      city: "Campinas",
      state: "SP",
    },
    weight: 18,
  },
  {
    code: "FIR",
    name: "Farmacêutica Ipê Roxo Ltda",
    tradeName: "Ipê Roxo Farma",
    cnpjRoot: "27650318",
    email: "garantiadaqualidade@iperoxo.example",
    phone: "(62) 3311-4586",
    address: {
      cep: "75094-080",
      street: "Via Industrial Norte",
      number: "1500",
      neighbourhood: "Distrito Agroindustrial",
      city: "Anápolis",
      state: "GO",
    },
    weight: 16,
  },
  {
    code: "CPS",
    name: "Cooperativa Agroindustrial Planalto Sereno",
    tradeName: "Coopersereno",
    cnpjRoot: "08573926",
    email: "laboratorio@coopersereno.example",
    phone: "(42) 3220-6107",
    address: {
      cep: "84016-210",
      street: "Rua Doutor Colares",
      number: "2210",
      neighbourhood: "Uvaranas",
      city: "Ponta Grossa",
      state: "PR",
    },
    weight: 11,
  },
  {
    code: "UPT",
    name: "Usinagem Precisão Tupã Ltda",
    tradeName: "Precisão Tupã",
    cnpjRoot: "19846275",
    email: "ferramentaria@precisaotupa.example",
    phone: "(54) 3028-3391",
    address: {
      cep: "95012-290",
      street: "Rua Os Dezoito do Forte",
      number: "640",
      neighbourhood: "São Pelegrino",
      city: "Caxias do Sul",
      state: "RS",
    },
    weight: 7,
  },
];

export function customerCnpj(entry: DemoCustomer): string {
  return makeCnpj(entry.cnpjRoot);
}

/** customer.id by DemoCustomer.code. */
export type CustomerIds = Map<string, number>;

/**
 * Creates the customers through the real route (which also provisions each
 * customer's portal organization), then sets the contact e-mail with a plain
 * update: giving the e-mail at creation would send a portal invitation to a
 * mailbox that does not exist.
 */
export async function seedCustomers(ctx: SeedContext): Promise<CustomerIds> {
  const ids: CustomerIds = new Map();
  for (const entry of DEMO_CUSTOMERS) {
    const taxId = customerCnpj(entry);
    const [existing] = await db
      .select({ id: customer.id })
      .from(customer)
      .where(
        and(eq(customer.labOrganizationId, LAB_ID), eq(customer.taxId, taxId)),
      )
      .limit(1);
    if (existing) {
      ids.set(entry.code, existing.id);
      continue;
    }
    const created = await ctx.api.call("owner", "POST", "/api/customers", {
      name: entry.name,
      tradeName: entry.tradeName,
      taxId,
      phone: entry.phone,
      address: entry.address,
    });
    const id = numberField(created, "id");
    await db
      .update(customer)
      .set({ email: entry.email })
      .where(eq(customer.id, id));
    ids.set(entry.code, id);
    ctx.log(`  customer ${entry.code} -> #${id} ${entry.name}`);
  }
  return ids;
}
