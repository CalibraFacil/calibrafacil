import type {
  ServiceOrderDetail,
  ServiceOrderDocumentUrl,
  ServiceOrdersListData,
} from "../service-orders";
import type {
  CreateServiceOrderInput,
  CreateServiceOrderQuoteInput,
  CreateServiceOrderResult,
  DeliverServiceOrderInput,
  IssueServiceOrderDeliveryDocumentInput,
  SaveServiceOrderEvaluationInput,
  SaveServiceOrderExecutionInput,
  SendServiceOrderQuoteInput,
  ServiceOrderRepairMarkInput,
  ServiceOrdersListInput,
  ServiceOrdersApi,
  UpdateServiceOrderInput,
} from "../types";
import { readJsonResponse } from "../transport/response";

export function createServiceOrdersApi(rawCloudClient: any): ServiceOrdersApi {
  return {
    async list(input: ServiceOrdersListInput) {
      return readJsonResponse<ServiceOrdersListData>(
        await rawCloudClient.api["service-orders"].$get({
          query: {
            page: String(input.page),
            limit: String(input.limit),
            query: input.query || undefined,
            status: input.status || undefined,
          },
        }),
        "Erro ao carregar ordens de serviço",
      );
    },
    async get(id: string | number) {
      const result = await readJsonResponse<{ data: ServiceOrderDetail }>(
        await rawCloudClient.api["service-orders"][":id"].$get({
          param: { id: String(id) },
        }),
        "Erro ao carregar OS",
      );

      return result.data;
    },
    async create(input: CreateServiceOrderInput) {
      return readJsonResponse<CreateServiceOrderResult>(
        await rawCloudClient.api["service-orders"].$post({ json: input }),
        "Erro ao criar OS",
      );
    },
    async update(id: string | number, input: UpdateServiceOrderInput) {
      return readJsonResponse<{ data: ServiceOrderDetail }>(
        await rawCloudClient.api["service-orders"][":id"].$patch({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao atualizar OS",
      );
    },
    async createQuote(
      id: string | number,
      input: CreateServiceOrderQuoteInput,
    ) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api["service-orders"][":id"].quotes.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao salvar orçamento",
      );
    },
    async saveEvaluation(
      id: string | number,
      evaluationId: string | number | null,
      input: SaveServiceOrderEvaluationInput,
    ) {
      const response = evaluationId
        ? await rawCloudClient.api["service-orders"][":id"].evaluations[
            ":evaluationId"
          ].$patch({
            param: { id: String(id), evaluationId: String(evaluationId) },
            json: input,
          })
        : await rawCloudClient.api["service-orders"][":id"].evaluations.$post({
            param: { id: String(id) },
            json: input,
          });

      return readJsonResponse<unknown>(response, "Erro ao salvar avaliação");
    },
    async sendQuote(
      id: string | number,
      quoteId: string | number,
      input: SendServiceOrderQuoteInput,
    ) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api["service-orders"][":id"].quotes[
          ":quoteId"
        ].send.$post({
          param: { id: String(id), quoteId: String(quoteId) },
          json: input,
        }),
        "Erro ao emitir orçamento",
      );
    },
    async saveExecution(
      id: string | number,
      input: SaveServiceOrderExecutionInput,
    ) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api["service-orders"][
          ":id"
        ].execution.finish.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao salvar execução",
      );
    },
    async generateIntakeDocument(id: string | number) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api["service-orders"][":id"][
          "intake-document"
        ].$post({
          param: { id: String(id) },
        }),
        "Erro ao gerar comprovante",
      );
    },
    async getIntakeDocumentPdf(id: string | number) {
      return readJsonResponse<ServiceOrderDocumentUrl>(
        await rawCloudClient.api["service-orders"][":id"][
          "intake-document.pdf"
        ].$get({
          param: { id: String(id) },
        }),
        "PDF ainda indisponível",
      );
    },
    async generateTag(id: string | number) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api["service-orders"][":id"].tag.$post({
          param: { id: String(id) },
        }),
        "Erro ao gerar etiqueta",
      );
    },
    async getTagPdf(id: string | number) {
      return readJsonResponse<ServiceOrderDocumentUrl>(
        await rawCloudClient.api["service-orders"][":id"]["tag.pdf"].$get({
          param: { id: String(id) },
        }),
        "PDF ainda indisponível",
      );
    },
    async updateRepairMark(
      id: string | number,
      input: ServiceOrderRepairMarkInput,
    ) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api["service-orders"][":id"]["repair-mark"].$patch(
          {
            param: { id: String(id) },
            json: input,
          },
        ),
        "Erro ao salvar a Marca de Reparo",
      );
    },
    async deliver(id: string | number, input: DeliverServiceOrderInput) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api["service-orders"][":id"].deliver.$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao registrar entrega",
      );
    },
    async issueDeliveryDocument(
      id: string | number,
      input: IssueServiceOrderDeliveryDocumentInput,
    ) {
      return readJsonResponse<unknown>(
        await rawCloudClient.api["service-orders"][":id"][
          "delivery-document"
        ].$post({
          param: { id: String(id) },
          json: input,
        }),
        "Erro ao gerar comprovante de entrega",
      );
    },
    async getDeliveryDocumentPdf(id: string | number) {
      return readJsonResponse<ServiceOrderDocumentUrl>(
        await rawCloudClient.api["service-orders"][":id"][
          "delivery-document.pdf"
        ].$get({
          param: { id: String(id) },
        }),
        "PDF ainda indisponível",
      );
    },
  };
}
