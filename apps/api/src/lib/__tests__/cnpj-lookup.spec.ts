import { describe, expect, it } from "vitest";

import { mapBrasilApi, mapOpenCnpj } from "../cnpj-lookup";

const CNPJ14 = "11444777000161";
const FORMATTED = "11.444.777/0001-61";

describe("mapOpenCnpj", () => {
  it("maps a real OpenCNPJ payload, keeping razao social verbatim", () => {
    const result = mapOpenCnpj(
      {
        cnpj: CNPJ14,
        razao_social:
          "CONSTRUTORA MODELO LTDA",
        nome_fantasia: "MODELO",
        situacao_cadastral: "Ativa",
        tipo_logradouro: "RODOVIA",
        logradouro: "DAS INDUSTRIAS",
        numero: "S/N",
        complemento:
          "LOTE  013                 QUADRA066                 SETOR 010",
        bairro: "NAO INFORMADO",
        cep: "99500000",
        uf: "RS",
        municipio: "CIDADE MODELO",
        email: "COMPRAS@MODELO.COM.BR",
        telefones: [
          { ddd: "51", numero: "30000001", is_fax: false },
          { ddd: "51", numero: "30000002", is_fax: true },
        ],
      },
      CNPJ14,
    );

    expect(result).toEqual({
      taxId: FORMATTED,
      name: "CONSTRUTORA MODELO LTDA",
      tradeName: "MODELO",
      email: "COMPRAS@MODELO.COM.BR",
      phone: "(51) 3000-0001",
      status: "Ativa",
      address: {
        cep: "99500-000",
        street: "RODOVIA DAS INDUSTRIAS",
        number: "S/N",
        complement: "LOTE 013 QUADRA066 SETOR 010",
        neighbourhood: "NAO INFORMADO",
        city: "CIDADE MODELO",
        state: "RS",
      },
    });
  });

  it("prefers the first non-fax phone", () => {
    const result = mapOpenCnpj(
      {
        razao_social: "ACME LTDA",
        telefones: [
          { ddd: "11", numero: "5555000", is_fax: true },
          { ddd: "11", numero: "999998888", is_fax: false },
        ],
      },
      CNPJ14,
    );
    expect(result?.phone).toBe("(11) 99999-8888");
  });

  it("returns null when razao social is absent", () => {
    expect(mapOpenCnpj({ nome_fantasia: "ACME" }, CNPJ14)).toBeNull();
  });

  it("returns null for non-object payloads", () => {
    expect(mapOpenCnpj("not found", CNPJ14)).toBeNull();
  });
});

describe("mapBrasilApi", () => {
  it("maps a real BrasilAPI payload with a null email", () => {
    const result = mapBrasilApi(
      {
        cnpj: CNPJ14,
        razao_social:
          "CONSTRUTORA MODELO LTDA",
        nome_fantasia: "MODELO",
        descricao_situacao_cadastral: "ATIVA",
        descricao_tipo_de_logradouro: "RODOVIA",
        logradouro: "DAS INDUSTRIAS",
        numero: "S/N",
        complemento: "LOTE 013 QUADRA066 SETOR 010",
        bairro: "NAO INFORMADO",
        cep: "99500000",
        uf: "RS",
        municipio: "CIDADE MODELO",
        email: null,
        ddd_telefone_1: "5130000001",
      },
      CNPJ14,
    );

    expect(result).toEqual({
      taxId: FORMATTED,
      name: "CONSTRUTORA MODELO LTDA",
      tradeName: "MODELO",
      email: null,
      phone: "(51) 3000-0001",
      status: "ATIVA",
      address: {
        cep: "99500-000",
        street: "RODOVIA DAS INDUSTRIAS",
        number: "S/N",
        complement: "LOTE 013 QUADRA066 SETOR 010",
        neighbourhood: "NAO INFORMADO",
        city: "CIDADE MODELO",
        state: "RS",
      },
    });
  });

  it("accepts a numeric cep", () => {
    const result = mapBrasilApi(
      { razao_social: "ACME LTDA", cep: 99500000 },
      CNPJ14,
    );
    expect(result?.address.cep).toBe("99500-000");
  });
});
