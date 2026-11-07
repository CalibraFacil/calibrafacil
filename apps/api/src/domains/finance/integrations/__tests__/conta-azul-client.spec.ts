import { describe, expect, it, vi } from "vitest";
import {
  ContaAzulApiError,
  ContaAzulClient,
  clampContaAzulPageSize,
} from "../conta-azul-client";

const leakingErrorFetch: typeof fetch = async () =>
  Response.json(
    {
      code: "BAD_REQUEST",
      message: "payload inválido",
      access_token: "access-secret",
      authorization: "Bearer access-secret",
    },
    { status: 400 },
  );

const nestedLeakingErrorFetch: typeof fetch = async () =>
  Response.json(
    {
      code: "BAD_REQUEST",
      message:
        "erro no documento 11222333000181 e chave 42250323643586000108550010000001151606401726",
      validation: {
        Authorization: "Bearer nested-access-secret",
        payload: {
          cpf: "12345678901",
          fiscalXml: "<xml>42250323643586000108550010000001151606401726</xml>",
        },
        errors: [
          {
            field: "cnpj",
            value: "11222333000181",
            message: "CNPJ 11222333000181 inválido",
          },
        ],
      },
    },
    { status: 422 },
  );

describe("ContaAzulClient", () => {
  it("sends bearer JSON requests to documented Conta Azul paths", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      authorization: string | null;
      contentType: string | null;
      body: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(input),
        method: init?.method,
        authorization: headers.get("authorization"),
        contentType: headers.get("content-type"),
        body: JSON.parse(String(init?.body)),
      });
      return Response.json({ id: "pessoa-1" });
    };
    const client = new ContaAzulClient({
      accessToken: "access-1",
      fetchImpl,
    });

    await expect(
      client.createPessoa({
        nome: "Cliente Exemplo",
        tipo_pessoa: "Jurídica",
        cnpj: "11222333000181",
        perfis: [{ tipo_perfil: "Cliente" }],
      }),
    ).resolves.toEqual({ id: "pessoa-1" });
    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/pessoas",
        method: "POST",
        authorization: "Bearer access-1",
        contentType: "application/json",
        body: {
          nome: "Cliente Exemplo",
          tipo_pessoa: "Jurídica",
          cnpj: "11222333000181",
          perfis: [{ tipo_perfil: "Cliente" }],
        },
      },
    ]);
  });

  it("creates products through the documented inventory endpoint", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: JSON.parse(String(init?.body)),
      });
      return Response.json({ id: "product-1" }, { status: 201 });
    };
    const client = new ContaAzulClient({
      accessToken: "access-1",
      fetchImpl,
    });

    await expect(
      client.createProduct({
        nome: "Peso padrão",
        codigo_sku: "PESO-001",
        formato: "SIMPLES",
        status: "ATIVO",
      }),
    ).resolves.toEqual({ id: "product-1" });
    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/produtos",
        method: "POST",
        body: {
          nome: "Peso padrão",
          codigo_sku: "PESO-001",
          formato: "SIMPLES",
          status: "ATIVO",
        },
      },
    ]);
  });

  it("loads product taxonomy references through documented inventory endpoints", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requestedUrls.push(String(input));
      return Response.json({ items: [] });
    };
    const client = new ContaAzulClient({
      accessToken: "access-1",
      fetchImpl,
    });

    await expect(
      client.listProductCategories({
        pagina: 1,
        tamanho_pagina: 100,
      }),
    ).resolves.toEqual({ items: [] });
    await expect(client.listProductCest()).resolves.toEqual({ items: [] });
    await expect(client.listProductNcm()).resolves.toEqual({ items: [] });
    await expect(client.listProductUnits()).resolves.toEqual({ items: [] });

    expect(requestedUrls).toEqual([
      "https://api-v2.contaazul.com/v1/produtos/categorias?pagina=1&tamanho_pagina=100",
      "https://api-v2.contaazul.com/v1/produtos/cest",
      "https://api-v2.contaazul.com/v1/produtos/ncm",
      "https://api-v2.contaazul.com/v1/produtos/unidades-medida",
    ]);
  });

  it("loads services through the read-only services reference endpoint", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requestedUrls.push(String(input));
      return Response.json({ items: [{ id: "service-1" }] });
    };
    const client = new ContaAzulClient({
      accessToken: "access-1",
      fetchImpl,
    });

    await expect(
      client.searchServices({
        pagina: 1,
        tamanho_pagina: 100,
      }),
    ).resolves.toEqual({ items: [{ id: "service-1" }] });
    expect(requestedUrls).toEqual([
      "https://api-v2.contaazul.com/v1/servicos?pagina=1&tamanho_pagina=100",
    ]);
  });

  it("loads sellers and DRE categories through documented reference endpoints", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requestedUrls.push(String(input));
      return Response.json({ itens: [] });
    };
    const client = new ContaAzulClient({
      accessToken: "access-1",
      fetchImpl,
    });

    await expect(client.listSellers()).resolves.toEqual({ itens: [] });
    await expect(client.listDreCategories()).resolves.toEqual({ itens: [] });

    expect(requestedUrls).toEqual([
      "https://api-v2.contaazul.com/v1/venda/vendedores",
      "https://api-v2.contaazul.com/v1/financeiro/categorias-dre",
    ]);
  });

  it("covers documented sales endpoints including PDF documents", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      accept: string | null;
      contentType: string | null;
      body: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(input),
        method: init?.method,
        accept: headers.get("accept"),
        contentType: headers.get("content-type"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      if (String(input).endsWith("/imprimir")) {
        return new Response(new TextEncoder().encode("pdf-content"), {
          status: 200,
          headers: {
            "content-type": "application/pdf",
          },
        });
      }

      if (String(input).endsWith("/proximo-numero")) {
        return Response.json(4512645);
      }

      return Response.json({ id: "sale-1" });
    };
    const client = new ContaAzulClient({
      accessToken: "access-1",
      fetchImpl,
    });
    const salePayload = {
      id_cliente: "customer-1",
      numero: 4512645,
      situacao: "APROVADO" as const,
      data_venda: "2026-05-24",
      id_categoria: "category-1",
      id_centro_custo: "cost-center-1",
      id_vendedor: "seller-1",
      observacoes: "Venda originada no CalibraFácil",
      observacoes_pagamento: "Pagamento conforme faturamento",
      itens: [
        {
          id: "service-1",
          quantidade: 1,
          descricao: "Calibracao",
          valor: 150,
        },
      ],
      condicao_pagamento: {
        tipo_pagamento: "BOLETO_BANCARIO",
        id_conta_financeira: "account-1",
        opcao_condicao_pagamento: "À vista",
        parcelas: [
          {
            data_vencimento: "2026-06-24",
            valor: 150,
            descricao: "Parcela 1",
          },
        ],
      },
    };

    await expect(client.createSale(salePayload)).resolves.toEqual({
      id: "sale-1",
    });
    await expect(client.putSale("sale-1", salePayload)).resolves.toEqual({
      id: "sale-1",
    });
    await expect(client.getSale("sale-1")).resolves.toEqual({ id: "sale-1" });
    await expect(
      client.searchSales({
        pagina: 1,
        tamanho_pagina: 100,
        termo_busca: "4512645",
      }),
    ).resolves.toEqual({ id: "sale-1" });
    await expect(client.getSaleItems("sale-1")).resolves.toEqual({
      id: "sale-1",
    });
    await expect(client.deleteSalesBatch({ ids: ["sale-1"] })).resolves.toEqual(
      { id: "sale-1" },
    );
    await expect(client.getNextSaleNumber()).resolves.toBe(4512645);
    const pdf = await client.getSalePdf("sale-1");
    expect(pdf.contentType).toBe("application/pdf");
    expect(new TextDecoder().decode(pdf.body)).toBe("pdf-content");

    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/venda",
        method: "POST",
        accept: "application/json",
        contentType: "application/json",
        body: salePayload,
      },
      {
        url: "https://api-v2.contaazul.com/v1/venda/sale-1",
        method: "PUT",
        accept: "application/json",
        contentType: "application/json",
        body: salePayload,
      },
      {
        url: "https://api-v2.contaazul.com/v1/venda/sale-1",
        method: "GET",
        accept: "application/json",
        contentType: null,
        body: null,
      },
      {
        url: "https://api-v2.contaazul.com/v1/venda/busca?pagina=1&tamanho_pagina=100&termo_busca=4512645",
        method: "GET",
        accept: "application/json",
        contentType: null,
        body: null,
      },
      {
        url: "https://api-v2.contaazul.com/v1/venda/sale-1/itens",
        method: "GET",
        accept: "application/json",
        contentType: null,
        body: null,
      },
      {
        url: "https://api-v2.contaazul.com/v1/venda/exclusao-lote",
        method: "POST",
        accept: "application/json",
        contentType: "application/json",
        body: { ids: ["sale-1"] },
      },
      {
        url: "https://api-v2.contaazul.com/v1/venda/proximo-numero",
        method: "GET",
        accept: "application/json",
        contentType: null,
        body: null,
      },
      {
        url: "https://api-v2.contaazul.com/v1/venda/sale-1/imprimir",
        method: "GET",
        accept: "application/pdf",
        contentType: null,
        body: null,
      },
    ]);
  });

  it("covers documented recurring contract endpoints", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (String(input).endsWith("/proximo-numero")) {
        return Response.json(4512645);
      }
      return Response.json({ id: "contract-1", id_venda: "sale-1" });
    };
    const client = new ContaAzulClient({
      accessToken: "access-1",
      fetchImpl,
    });
    const contractPayload = {
      id_cliente: "customer-1",
      data_emissao: "2026-05-24",
      id_categoria: "category-1",
      id_centro_custo: "cost-center-1",
      id_vendedor: "seller-1",
      observacoes: "Contrato recorrente CalibraFácil",
      termos: {
        tipo_frequencia: "MENSAL" as const,
        tipo_expiracao: "DATA" as const,
        data_inicio: "2026-06-01",
        data_fim: "2027-06-01",
        intervalo_frequencia: 1,
        dia_emissao_venda: 1,
        numero: 4512645,
      },
      condicao_pagamento: {
        tipo_pagamento: "BOLETO_BANCARIO",
        id_conta_financeira: "account-1",
        dia_vencimento: 10,
        primeira_data_vencimento: "2026-06-10",
      },
      itens: [
        {
          id: "service-1",
          quantidade: 1,
          descricao: "Calibracao recorrente",
          valor: 100,
        },
      ],
    };

    await expect(client.createContract(contractPayload)).resolves.toEqual({
      id: "contract-1",
      id_venda: "sale-1",
    });
    await expect(
      client.searchContracts({
        pagina: 1,
        tamanho_pagina: 10,
        cliente_id: "customer-1",
        data_inicio: "2026-06-01",
        data_fim: "2027-06-01",
      }),
    ).resolves.toEqual({ id: "contract-1", id_venda: "sale-1" });
    await expect(client.getNextContractNumber()).resolves.toBe(4512645);

    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/contratos",
        method: "POST",
        body: contractPayload,
      },
      {
        url: "https://api-v2.contaazul.com/v1/contratos?pagina=1&tamanho_pagina=10&cliente_id=customer-1&data_inicio=2026-06-01&data_fim=2027-06-01",
        method: "GET",
        body: null,
      },
      {
        url: "https://api-v2.contaazul.com/v1/contratos/proximo-numero",
        method: "GET",
        body: null,
      },
    ]);
  });

  it("covers documented fiscal consultation and MDF-e linkage endpoints", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (
        String(input).includes(
          "/v1/notas-fiscais/42250323643586000108550010000001151606401726",
        )
      ) {
        return new Response("<root>xml</root>", {
          status: 200,
          headers: {
            "content-type": "application/xml",
          },
        });
      }
      if (String(input).endsWith("/v1/notas-fiscais/vinculo-mdfe")) {
        return new Response(null, { status: 204 });
      }
      return Response.json({ ok: true });
    };
    const client = new ContaAzulClient({
      accessToken: "access-1",
      fetchImpl,
    });
    const mdfePayload = {
      chaves_acesso: [
        "42250323643586000108550010000001151606401726",
        "42250323643586000108550010000001141054498495",
      ],
      identificador: "MDFE-345345",
      status: "ENCERRADO" as const,
    };

    await expect(
      client.searchProductInvoices({
        data_inicial: "2026-05-01",
        data_final: "2026-05-15",
        pagina: 1,
        tamanho_pagina: 10,
        id_venda: "sale-1",
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      client.searchServiceInvoices({
        data_competencia_de: "2026-05-01",
        data_competencia_ate: "2026-05-15",
        pagina: 1,
        tamanho_pagina: 10,
        id_cliente: ["customer-1", "customer-2"],
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      client.getInvoiceByAccessKey(
        "42250323643586000108550010000001151606401726",
      ),
    ).resolves.toBe("<root>xml</root>");
    await expect(client.linkInvoicesToMdfe(mdfePayload)).resolves.toBeNull();

    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/notas-fiscais?data_inicial=2026-05-01&data_final=2026-05-15&pagina=1&tamanho_pagina=10&id_venda=sale-1",
        method: "GET",
        body: null,
      },
      {
        url: "https://api-v2.contaazul.com/v1/notas-fiscais-servico?data_competencia_de=2026-05-01&data_competencia_ate=2026-05-15&pagina=1&tamanho_pagina=10&id_cliente=customer-1&id_cliente=customer-2",
        method: "GET",
        body: null,
      },
      {
        url: "https://api-v2.contaazul.com/v1/notas-fiscais/42250323643586000108550010000001151606401726",
        method: "GET",
        body: null,
      },
      {
        url: "https://api-v2.contaazul.com/v1/notas-fiscais/vinculo-mdfe",
        method: "POST",
        body: mdfePayload,
      },
    ]);
  });

  it("covers payable events, balances, transfers and baixa endpoints", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      // The baixa DELETE returns a 2xx with an empty, non-JSON body.
      if (init?.method === "DELETE") {
        return new Response("", { status: 200 });
      }
      return Response.json({ ok: true });
    };
    const client = new ContaAzulClient({
      accessToken: "access-1",
      fetchImpl,
    });
    const payablePayload = {
      data_competencia: "2026-05-24",
      valor: 150,
      observacao: "Custo terceirizado",
      descricao: "Calibracao terceirizada",
      contato: "supplier-1",
      conta_financeira: "account-1",
      condicao_pagamento: {
        parcelas: [
          {
            descricao: "Parcela 1",
            data_vencimento: "2026-06-24",
            nota: "payable:42",
            conta_financeira: "account-1",
            detalhe_valor: {
              valor_bruto: 150,
            },
          },
        ],
      },
    };
    const baixaPayload = {
      data_pagamento: "2026-06-24",
      composicao_valor: {
        valor_bruto: 150,
        juros: 0,
        multa: 0,
        desconto: 0,
        taxa: 0,
      },
      conta_financeira: "account-1",
      metodo_pagamento: "PIX" as const,
      observacao: "Baixa sincronizada",
      nsu: "nsu-1",
    };

    await expect(client.createPayableEvent(payablePayload)).resolves.toEqual({
      ok: true,
    });
    await expect(client.getProtocol("protocol-1")).resolves.toEqual({
      ok: true,
    });
    await expect(
      client.searchPayableEvents({
        pagina: 1,
        tamanho_pagina: 100,
        status: "PENDENTE",
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      client.getFinancialAccountBalance("account-1"),
    ).resolves.toEqual({ ok: true });
    await expect(
      client.listFinancialTransfers({
        pagina: 1,
        tamanho_pagina: 100,
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      client.createAcquittance("installment-1", baixaPayload),
    ).resolves.toEqual({ ok: true });
    await expect(
      client.listInstallmentAcquittances("installment-1"),
    ).resolves.toEqual({ ok: true });
    await expect(
      client.patchAcquittance("baixa-1", {
        versao: 1,
        observacao: "Baixa ajustada",
      }),
    ).resolves.toEqual({ ok: true });
    await expect(client.getAcquittance("baixa-1")).resolves.toEqual({
      ok: true,
    });
    await expect(client.deleteAcquittance("baixa-1")).resolves.toBe("");

    expect(requests).toEqual([
      {
        url: "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/contas-a-pagar",
        method: "POST",
        body: payablePayload,
      },
      {
        url: "https://api-v2.contaazul.com/v1/protocolo/protocol-1",
        method: "GET",
        body: null,
      },
      {
        url: "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar?pagina=1&tamanho_pagina=100&status=PENDENTE",
        method: "GET",
        body: null,
      },
      {
        url: "https://api-v2.contaazul.com/v1/conta-financeira/account-1/saldo-atual",
        method: "GET",
        body: null,
      },
      {
        url: "https://api-v2.contaazul.com/v1/financeiro/transferencias?pagina=1&tamanho_pagina=100",
        method: "GET",
        body: null,
      },
      {
        url: "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/installment-1/baixa",
        method: "POST",
        body: baixaPayload,
      },
      {
        url: "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/installment-1/baixa",
        method: "GET",
        body: null,
      },
      {
        url: "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/baixa/baixa-1",
        method: "PATCH",
        body: {
          versao: 1,
          observacao: "Baixa ajustada",
        },
      },
      {
        url: "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/baixa/baixa-1",
        method: "GET",
        body: null,
      },
      {
        url: "https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/parcelas/baixa/baixa-1",
        method: "DELETE",
        body: null,
      },
    ]);
  });

  it("refreshes the access token once on 401 and retries the request", async () => {
    const authorizations: string[] = [];
    let calls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls += 1;
      authorizations.push(
        new Headers(init?.headers).get("authorization") ?? "",
      );
      if (calls === 1) {
        return Response.json({ message: "expired" }, { status: 401 });
      }

      return Response.json({ ok: true });
    };
    const client = new ContaAzulClient({
      accessToken: "access-1",
      fetchImpl,
      async onUnauthorized() {
        return "access-2";
      },
    });

    await expect(client.getPessoa("pessoa-1")).resolves.toEqual({ ok: true });
    expect(authorizations).toEqual(["Bearer access-1", "Bearer access-2"]);
  });

  it("propagates unauthorized refresh failures without retrying stale credentials", async () => {
    const refreshError = new Error("Conta Azul reconnection required");
    const requestedUrls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requestedUrls.push(String(input));
      return Response.json({ message: "expired" }, { status: 401 });
    };
    const client = new ContaAzulClient({
      accessToken: "expired-access",
      fetchImpl,
      async onUnauthorized() {
        throw refreshError;
      },
    });

    await expect(client.listFinancialAccounts()).rejects.toBe(refreshError);
    expect(requestedUrls).toEqual([
      "https://api-v2.contaazul.com/v1/conta-financeira",
    ]);
  });

  it("retries throttled and transient server responses", async () => {
    const statuses = [429, 502, 200];
    const requestedUrls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requestedUrls.push(String(input));
      const status = statuses.shift() ?? 200;
      if (status === 200) {
        return Response.json([{ id: "acc-1" }]);
      }

      return Response.json(
        { message: "try again" },
        { status, headers: { "Retry-After": "0" } },
      );
    };
    const client = new ContaAzulClient({
      accessToken: "access-1",
      fetchImpl,
      retryDelayMs: 0,
      maxRetries: 3,
    });

    await expect(client.listFinancialAccounts()).resolves.toEqual([
      { id: "acc-1" },
    ]);
    expect(requestedUrls).toEqual([
      "https://api-v2.contaazul.com/v1/conta-financeira",
      "https://api-v2.contaazul.com/v1/conta-financeira",
      "https://api-v2.contaazul.com/v1/conta-financeira",
    ]);
  });

  it("paces concurrent requests that share a rate limit key", async () => {
    // A fake clock: on a busy machine the first request can reach fetch late,
    // which made the real-time gaps look shorter than the limiter's interval.
    vi.useFakeTimers();
    try {
      const startedAt: number[] = [];
      const fetchImpl: typeof fetch = async () => {
        startedAt.push(Date.now());
        return Response.json({ ok: true });
      };
      const client = new ContaAzulClient({
        accessToken: "access-1",
        fetchImpl,
        minRequestIntervalMs: 20,
        rateLimitKey: `test-rate-limit-${crypto.randomUUID()}`,
      });

      const requests = Promise.all([
        client.getPessoa("pessoa-1"),
        client.getPessoa("pessoa-2"),
        client.getPessoa("pessoa-3"),
      ]);
      await vi.advanceTimersByTimeAsync(100);
      await requests;

      expect(startedAt).toHaveLength(3);
      const [firstRequestAt, secondRequestAt, thirdRequestAt] = startedAt;
      if (
        firstRequestAt === undefined ||
        secondRequestAt === undefined ||
        thirdRequestAt === undefined
      ) {
        throw new Error("expected three request timestamps");
      }
      expect(secondRequestAt - firstRequestAt).toBeGreaterThanOrEqual(20);
      expect(thirdRequestAt - secondRequestAt).toBeGreaterThanOrEqual(20);
    } finally {
      vi.useRealTimers();
    }
  });

  it("normalizes API errors without leaking tokens", async () => {
    const client = new ContaAzulClient({
      accessToken: "access-secret",
      fetchImpl: leakingErrorFetch,
      maxRetries: 0,
    });

    try {
      await client.getInstallment("installment-1");
      throw new Error("expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ContaAzulApiError);
      if (!(error instanceof ContaAzulApiError)) throw error;

      expect(error.status).toBe(400);
      expect(error.code).toBe("BAD_REQUEST");
      expect(error.message).toBe("payload inválido");
      expect(JSON.stringify(error.details)).not.toContain("access-secret");
      expect(error.details).toMatchObject({
        access_token: "[redacted]",
        authorization: "[redacted]",
      });
    }
  });

  it("recursively redacts sensitive Conta Azul error details", async () => {
    const client = new ContaAzulClient({
      accessToken: "nested-access-secret",
      fetchImpl: nestedLeakingErrorFetch,
      maxRetries: 0,
    });

    try {
      await client.listFinancialAccounts();
      throw new Error("expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ContaAzulApiError);
      if (!(error instanceof ContaAzulApiError)) throw error;

      const serializedDetails = JSON.stringify(error.details);
      expect(error.message).not.toContain("11222333000181");
      expect(error.message).not.toContain(
        "42250323643586000108550010000001151606401726",
      );
      expect(serializedDetails).not.toContain("nested-access-secret");
      expect(serializedDetails).not.toContain("12345678901");
      expect(serializedDetails).not.toContain("11222333000181");
      expect(serializedDetails).not.toContain(
        "42250323643586000108550010000001151606401726",
      );
      expect(error.details).toMatchObject({
        validation: {
          Authorization: "[redacted]",
          payload: "[redacted]",
          errors: [
            {
              field: "cnpj",
              value: "[cnpj-redacted]",
              message: "CNPJ [cnpj-redacted] inválido",
            },
          ],
        },
      });
    }
  });
});

describe("clampContaAzulPageSize", () => {
  it("snaps each request down to the largest allowed page size", () => {
    expect(clampContaAzulPageSize(10)).toBe(10);
    expect(clampContaAzulPageSize(15)).toBe(10);
    expect(clampContaAzulPageSize(20)).toBe(20);
    expect(clampContaAzulPageSize(75)).toBe(50);
    expect(clampContaAzulPageSize(100)).toBe(100);
    expect(clampContaAzulPageSize(199)).toBe(100);
    expect(clampContaAzulPageSize(1000)).toBe(1000);
  });

  it("floors values below the minimum to 10 and caps values above 1000 to 1000", () => {
    expect(clampContaAzulPageSize(0)).toBe(10);
    expect(clampContaAzulPageSize(1)).toBe(10);
    expect(clampContaAzulPageSize(5000)).toBe(1000);
  });
});
