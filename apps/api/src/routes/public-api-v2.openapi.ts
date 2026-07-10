// Static OpenAPI 3.1 document for the Public API v2.
//
// Relocated verbatim from public-api-v2.ts (behavior-preserving structural
// extraction). This module is intentionally pure: it contains ONLY the static
// spec builders — no auth, no scope checks, no resource handlers, no DB access,
// no business logic. The served JSON is byte-identical to the previous inline
// definition; `buildPublicApiV2OpenApiDocument(origin)` interpolates the request
// origin into `servers[0].url` exactly as before.

type OpenApiParameter = {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  description?: string;
  schema: Record<string, unknown>;
};

function buildPathParameter(
  name: string,
  description: string,
): OpenApiParameter {
  return {
    name,
    in: "path",
    required: true,
    description,
    schema: { type: "string" },
  };
}

function buildListOperation(
  summary: string,
  tag: string,
  extraParameters: OpenApiParameter[] = [],
) {
  return {
    tags: [tag],
    summary,
    security: [{ ApiKeyAuth: [] }],
    parameters: [
      {
        name: "page",
        in: "query",
        schema: { type: "integer", minimum: 1, default: 1 },
      },
      {
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      ...extraParameters,
    ],
    responses: {
      200: {
        description: "Lista retornada com sucesso",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                data: {
                  type: "array",
                  items: { type: "object", additionalProperties: true },
                },
                meta: { $ref: "#/components/schemas/ListMeta" },
              },
            },
          },
        },
      },
      401: { $ref: "#/components/responses/Unauthorized" },
      403: { $ref: "#/components/responses/Forbidden" },
    },
  };
}

function buildDetailOperation(
  summary: string,
  tag: string,
  idName = "id",
  idDescription = "Identificador interno ou externalId",
) {
  return {
    tags: [tag],
    summary,
    security: [{ ApiKeyAuth: [] }],
    parameters: [buildPathParameter(idName, idDescription)],
    responses: {
      200: {
        description: "Recurso retornado com sucesso",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                data: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      },
      401: { $ref: "#/components/responses/Unauthorized" },
      403: { $ref: "#/components/responses/Forbidden" },
      404: { $ref: "#/components/responses/NotFound" },
    },
  };
}

function buildMutationOperation(params: {
  summary: string;
  tag: string;
  requestBodyDescription: string;
  responseStatus?: 200 | 201;
  pathParameters?: OpenApiParameter[];
  idempotent?: boolean;
}) {
  const responseStatus = params.responseStatus ?? 200;

  return {
    tags: [params.tag],
    summary: params.summary,
    security: [{ ApiKeyAuth: [] }],
    parameters: [
      ...(params.pathParameters ?? []),
      ...(params.idempotent
        ? [
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              description:
                "Chave obrigatória para evitar mutações duplicadas em integrações externas.",
              schema: { type: "string" },
            },
          ]
        : []),
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            additionalProperties: true,
          },
          examples: {
            default: {
              summary: params.requestBodyDescription,
              value: {},
            },
          },
        },
      },
    },
    responses: {
      [responseStatus]: {
        description: "Mutação concluída com sucesso",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                data: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      },
      400: { $ref: "#/components/responses/BadRequest" },
      401: { $ref: "#/components/responses/Unauthorized" },
      403: { $ref: "#/components/responses/Forbidden" },
      404: { $ref: "#/components/responses/NotFound" },
      409: { $ref: "#/components/responses/Conflict" },
    },
  };
}

export function buildPublicApiV2OpenApiDocument(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "CalibraFácil Public API",
      version: "2.0.0",
      description:
        "API pública resource-first para integrações e conectores operacionais do CalibraFácil.",
    },
    servers: [
      {
        url: `${origin}/api/public/v2`,
        description: "Current environment",
      },
    ],
    tags: [
      { name: "Customers" },
      { name: "Assets" },
      { name: "Requests" },
      { name: "Jobs" },
      { name: "Services" },
      { name: "Units" },
      { name: "Reports" },
      { name: "Certificates" },
      { name: "Webhooks" },
    ],
    security: [{ ApiKeyAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
          description:
            "Também aceita Authorization: Bearer <api-key> nas mesmas rotas.",
        },
      },
      schemas: {
        PublicError: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: { type: "object", additionalProperties: true },
              },
            },
          },
        },
        ListMeta: {
          type: "object",
          properties: {
            page: { type: "integer" },
            limit: { type: "integer" },
            total: { type: "integer" },
            hasNextPage: { type: "boolean" },
            filters: { type: "object", additionalProperties: true },
          },
        },
      },
      responses: {
        BadRequest: {
          description: "Payload ou parâmetros inválidos",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PublicError" },
            },
          },
        },
        Unauthorized: {
          description: "API key ausente ou inválida",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PublicError" },
            },
          },
        },
        Forbidden: {
          description: "Scope insuficiente para a operação",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PublicError" },
            },
          },
        },
        NotFound: {
          description: "Recurso não encontrado",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PublicError" },
            },
          },
        },
        Conflict: {
          description: "Conflito de domínio, externalId ou estado",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PublicError" },
            },
          },
        },
      },
    },
    paths: {
      "/customers": {
        get: buildListOperation("Listar clientes", "Customers", [
          { name: "query", in: "query", schema: { type: "string" } },
        ]),
        post: buildMutationOperation({
          summary: "Criar cliente",
          tag: "Customers",
          requestBodyDescription:
            "Cria um cliente. Aceita externalId para mapeamento estável e exige Idempotency-Key.",
          responseStatus: 201,
          idempotent: true,
        }),
      },
      "/customers/{id}": {
        get: buildDetailOperation("Obter cliente", "Customers"),
        put: buildMutationOperation({
          summary: "Atualizar cliente",
          tag: "Customers",
          requestBodyDescription:
            "Atualiza nome, contato e externalId do cliente.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
        delete: {
          tags: ["Customers"],
          summary: "Excluir cliente",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Cliente excluído",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/assets": {
        get: buildListOperation("Listar ativos", "Assets", [
          { name: "query", in: "query", schema: { type: "string" } },
          { name: "unitId", in: "query", schema: { type: "integer" } },
          { name: "customerId", in: "query", schema: { type: "integer" } },
          {
            name: "customerExternalId",
            in: "query",
            schema: { type: "string" },
          },
          { name: "status", in: "query", schema: { type: "string" } },
        ]),
        post: buildMutationOperation({
          summary: "Criar ativo",
          tag: "Assets",
          requestBodyDescription:
            "Cria um ativo associado a cliente e unidade, com externalId opcional e Idempotency-Key obrigatória.",
          responseStatus: 201,
          idempotent: true,
        }),
      },
      "/assets/{id}": {
        get: buildDetailOperation("Obter ativo", "Assets"),
        put: buildMutationOperation({
          summary: "Atualizar ativo",
          tag: "Assets",
          requestBodyDescription: "Atualiza dados operacionais do ativo.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
        delete: {
          tags: ["Assets"],
          summary: "Excluir ativo",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Ativo excluído",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/services": {
        get: buildListOperation("Listar serviços", "Services", [
          { name: "query", in: "query", schema: { type: "string" } },
          { name: "isActive", in: "query", schema: { type: "string" } },
        ]),
      },
      "/services/{id}": {
        get: buildDetailOperation("Obter serviço", "Services"),
      },
      "/units": {
        get: {
          tags: ["Units"],
          summary: "Listar unidades acessíveis",
          security: [{ ApiKeyAuth: [] }],
          responses: {
            200: {
              description: "Lista de unidades acessíveis",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: { type: "object", additionalProperties: true },
                      },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
          },
        },
      },
      "/units/{id}": {
        get: buildDetailOperation(
          "Obter unidade",
          "Units",
          "id",
          "Identificador interno da unidade",
        ),
      },
      "/reports/consolidated/executive-overview": {
        get: {
          tags: ["Reports"],
          summary: "Visão executiva consolidada",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "period",
              in: "query",
              schema: { type: "string", enum: ["7d", "30d", "90d", "month"] },
            },
            { name: "unitIds", in: "query", schema: { type: "string" } },
          ],
          responses: {
            200: {
              description: "Resumo executivo consolidado",
              content: {
                "application/json": {
                  schema: { type: "object", additionalProperties: true },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
          },
        },
      },
      "/reports/consolidated/comparison": {
        get: {
          tags: ["Reports"],
          summary: "Comparativo consolidado por unidade",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "period",
              in: "query",
              schema: { type: "string", enum: ["7d", "30d", "90d", "month"] },
            },
            { name: "unitIds", in: "query", schema: { type: "string" } },
          ],
          responses: {
            200: {
              description: "Comparativo consolidado",
              content: {
                "application/json": {
                  schema: { type: "object", additionalProperties: true },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
          },
        },
      },
      "/certificates": {
        get: buildListOperation("Listar certificados", "Certificates", [
          { name: "query", in: "query", schema: { type: "string" } },
          { name: "unitId", in: "query", schema: { type: "integer" } },
        ]),
      },
      "/certificates/{jobId}": {
        get: buildDetailOperation(
          "Obter metadados do certificado",
          "Certificates",
          "jobId",
          "Identificador do job",
        ),
      },
      "/certificates/{jobId}/download": {
        get: {
          tags: ["Certificates"],
          summary: "Baixar PDF do certificado",
          security: [{ ApiKeyAuth: [] }],
          parameters: [buildPathParameter("jobId", "Identificador do job")],
          responses: {
            200: {
              description: "Arquivo PDF do certificado",
              content: {
                "application/pdf": {
                  schema: { type: "string", format: "binary" },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/requests": {
        get: buildListOperation("Listar solicitações", "Requests", [
          { name: "query", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "customerId", in: "query", schema: { type: "integer" } },
          {
            name: "customerExternalId",
            in: "query",
            schema: { type: "string" },
          },
          { name: "unitId", in: "query", schema: { type: "integer" } },
        ]),
        post: buildMutationOperation({
          summary: "Criar solicitação",
          tag: "Requests",
          requestBodyDescription:
            "Cria uma solicitação de calibração com cliente, ativos e unidade. Exige Idempotency-Key.",
          responseStatus: 201,
          idempotent: true,
        }),
      },
      "/requests/{id}": {
        get: buildDetailOperation("Obter solicitação", "Requests"),
        patch: buildMutationOperation({
          summary: "Atualizar solicitação",
          tag: "Requests",
          requestBodyDescription: "Atualiza observações e data solicitada.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
      },
      "/requests/{id}/cancel": {
        post: buildMutationOperation({
          summary: "Cancelar solicitação",
          tag: "Requests",
          requestBodyDescription: "Cancela a solicitação com motivo explícito.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
          idempotent: true,
        }),
      },
      "/jobs": {
        get: buildListOperation("Listar ordens de serviço", "Jobs", [
          { name: "query", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "customerId", in: "query", schema: { type: "integer" } },
          {
            name: "customerExternalId",
            in: "query",
            schema: { type: "string" },
          },
          { name: "assetId", in: "query", schema: { type: "integer" } },
          { name: "assetExternalId", in: "query", schema: { type: "string" } },
          { name: "serviceId", in: "query", schema: { type: "integer" } },
          { name: "unitId", in: "query", schema: { type: "integer" } },
        ]),
        post: buildMutationOperation({
          summary: "Criar ordem de serviço",
          tag: "Jobs",
          requestBodyDescription:
            "Cria uma OS vinculada a ativo e serviço. Exige Idempotency-Key.",
          responseStatus: 201,
          idempotent: true,
        }),
      },
      "/jobs/{id}": {
        get: buildDetailOperation("Obter ordem de serviço", "Jobs"),
        patch: buildMutationOperation({
          summary: "Atualizar ordem de serviço",
          tag: "Jobs",
          requestBodyDescription: "Atualiza campos mutáveis da OS.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
        delete: buildMutationOperation({
          summary: "Cancelar ordem de serviço",
          tag: "Jobs",
          requestBodyDescription: "Cancela a OS com motivo explícito.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
      },
      "/jobs/{id}/results": {
        post: buildMutationOperation({
          summary: "Registrar resultados da OS",
          tag: "Jobs",
          requestBodyDescription: "Envia resultados executados para o job.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
      },
      "/jobs/{id}/submit": {
        post: buildMutationOperation({
          summary: "Submeter OS para revisão",
          tag: "Jobs",
          requestBodyDescription: "Submete o job para etapa de revisão.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
      },
      "/jobs/{id}/approve": {
        post: buildMutationOperation({
          summary: "Aprovar OS",
          tag: "Jobs",
          requestBodyDescription:
            "Aprova o job e libera certificado quando aplicável.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
      },
      "/jobs/{id}/reject": {
        post: buildMutationOperation({
          summary: "Rejeitar OS",
          tag: "Jobs",
          requestBodyDescription: "Rejeita o job com motivo explícito.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
      },
      "/webhooks": {
        get: {
          tags: ["Webhooks"],
          summary: "Listar subscriptions de webhook",
          security: [{ ApiKeyAuth: [] }],
          responses: {
            200: {
              description: "Lista de subscriptions",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: { type: "object", additionalProperties: true },
                      },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
          },
        },
        post: buildMutationOperation({
          summary: "Criar subscription de webhook",
          tag: "Webhooks",
          requestBodyDescription:
            "Configura endpoint, eventos e status da subscription.",
          responseStatus: 201,
        }),
      },
      "/webhooks/{id}": {
        patch: buildMutationOperation({
          summary: "Atualizar subscription de webhook",
          tag: "Webhooks",
          requestBodyDescription:
            "Atualiza nome, eventos, status ou URL do destino.",
          pathParameters: [
            buildPathParameter("id", "Identificador da subscription"),
          ],
        }),
        delete: {
          tags: ["Webhooks"],
          summary: "Excluir subscription de webhook",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            buildPathParameter("id", "Identificador da subscription"),
          ],
          responses: {
            200: {
              description: "Subscription excluída",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/webhooks/{id}/test": {
        post: {
          tags: ["Webhooks"],
          summary: "Disparar delivery de teste",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            buildPathParameter("id", "Identificador da subscription"),
          ],
          responses: {
            200: {
              description: "Delivery de teste emitido",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/webhooks/{id}/deliveries": {
        get: {
          tags: ["Webhooks"],
          summary: "Listar deliveries do webhook",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            buildPathParameter("id", "Identificador da subscription"),
          ],
          responses: {
            200: {
              description: "Histórico de deliveries",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: { type: "object", additionalProperties: true },
                      },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/webhooks/{id}/deliveries/{deliveryId}/replay": {
        post: {
          tags: ["Webhooks"],
          summary: "Reprocessar delivery",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            buildPathParameter("id", "Identificador da subscription"),
            buildPathParameter("deliveryId", "Identificador do delivery"),
          ],
          responses: {
            200: {
              description: "Replay enfileirado com sucesso",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" },
          },
        },
      },
    },
  };
}
