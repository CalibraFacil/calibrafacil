/**
 * REQ-SOEMAIL-041..062 (template rendering): the customer-facing email each
 * service-order status sends.
 *
 * The expected bodies below are the text of the emails as the eleven
 * per-status templates rendered it before they became one table-driven
 * template, so this is the regression pin for the copy: change a word in the
 * table and the matching case goes red. The vocabulary's own label appears
 * in the "Status" / "Etapa atual" row.
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import {
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_STATUSES,
} from "@calibra-facil/shared/service-orders";
import {
  SERVICE_ORDER_EMAIL_STATUSES,
  ServiceOrderStatusEmail,
  sendsServiceOrderStatusEmail,
  serviceOrderStatusEmailRequirement,
  serviceOrderStatusEmailSubject,
  type ServiceOrderEmailStatus,
} from "./service-order-status-email";

const BRAND = { name: "Lab Sigma", isWhiteLabel: true };
const SERVICE_ORDER_NUMBER = "OS-2026-701";
const CUSTOMER_NAME = "Empresa Avaliacao ME";

const EXPECTED: readonly {
  status: ServiceOrderEmailStatus;
  req: string;
  subject: string;
  /** The card of the email: from the badge to the closing paragraph. */
  body: string;
}[] = [
  {
    status: "awaiting_tech_evaluation",
    req: "REQ-SOEMAIL-043",
    subject: "OS OS-2026-701 — aguardando avaliação técnica",
    body: "Aguardando avaliação\n\n\nEQUIPAMENTO AGUARDA AVALIAÇÃO TÉCNICA\n\nOlá, Empresa Avaliacao ME! Seu equipamento na ordem de serviço OS-2026-701 está aguardando avaliação técnica pela equipe especializada de Lab Sigma.\n\nNúmero da OS\n\nOS-2026-701\n\nStatus\n\nAguardando avaliação do técnico\n\nEm breve nossa equipe técnica realizará a avaliação e informaremos você sobre os próximos passos. Obrigado pela paciência!",
  },
  {
    status: "under_evaluation",
    req: "REQ-SOEMAIL-044",
    subject: "OS OS-2026-701 — em avaliação técnica",
    body: "Em avaliação técnica\n\n\nAVALIAÇÃO TÉCNICA EM ANDAMENTO\n\nOlá, Empresa Avaliacao ME! A equipe técnica de Lab Sigma está realizando a avaliação do equipamento da ordem de serviço OS-2026-701.\n\nNúmero da OS\n\nOS-2026-701\n\nStatus\n\nEm avaliação técnica\n\nAssim que a avaliação for concluída, informaremos você sobre os resultados e os próximos passos. Obrigado pela confiança em Lab Sigma!",
  },
  {
    status: "repair_in_progress",
    req: "REQ-SOEMAIL-041",
    subject: "OS OS-2026-701 — serviço iniciado",
    body: "Serviço iniciado\n\n\nSERVIÇO EM ANDAMENTO\n\nOlá, Empresa Avaliacao ME! Lab Sigma iniciou a execução do serviço na sua ordem de serviço. Nossa equipe técnica está trabalhando no seu equipamento.\n\nNúmero da OS\n\nOS-2026-701\n\nStatus\n\nReparo em andamento\n\nEntraremos em contato quando o serviço for concluído. Obrigado pela confiança em Lab Sigma!",
  },
  {
    status: "awaiting_calibration",
    req: "REQ-SOEMAIL-042",
    subject: "OS OS-2026-701 — atualização do serviço",
    body: "Atualização do serviço\n\n\nATUALIZAÇÃO: AGUARDANDO CALIBRAÇÃO\n\nOlá, Empresa Avaliacao ME! Lab Sigma tem uma atualização sobre a sua ordem de serviço.\n\nNúmero da OS\n\nOS-2026-701\n\nEtapa atual\n\nAguardando calibração\n\nO serviço técnico foi concluído e o equipamento aguarda o processo de calibração.\n\nInformaremos você quando houver mais novidades. Obrigado pela paciência e pela confiança em Lab Sigma!",
  },
  {
    status: "calibration_in_progress",
    req: "REQ-SOEMAIL-042",
    subject: "OS OS-2026-701 — atualização do serviço",
    body: "Atualização do serviço\n\n\nATUALIZAÇÃO: CALIBRAÇÃO EM ANDAMENTO\n\nOlá, Empresa Avaliacao ME! Lab Sigma tem uma atualização sobre a sua ordem de serviço.\n\nNúmero da OS\n\nOS-2026-701\n\nEtapa atual\n\nCalibração em andamento\n\nO equipamento está sendo submetido ao processo de calibração pela equipe especializada.\n\nInformaremos você quando houver mais novidades. Obrigado pela paciência e pela confiança em Lab Sigma!",
  },
  {
    status: "awaiting_final_review",
    req: "REQ-SOEMAIL-054",
    subject: "OS OS-2026-701 — em revisão final",
    body: "Em revisão final\n\n\nSERVIÇO EM REVISÃO FINAL\n\nOlá, Empresa Avaliacao ME! O serviço da ordem de serviço OS-2026-701 está passando pela etapa de revisão final em Lab Sigma.\n\nNúmero da OS\n\nOS-2026-701\n\nStatus\n\nAguardando revisão final\n\nEstamos quase concluindo! Em breve você será notificado sobre a disponibilidade do equipamento. Obrigado pela paciência e pela confiança em Lab Sigma!",
  },
  {
    status: "ready_for_pickup",
    req: "REQ-SOEMAIL-051",
    subject: "OS OS-2026-701 — pronto para retirada",
    body: "Pronto para retirada\n\n\nSEU EQUIPAMENTO ESTÁ PRONTO PARA RETIRADA\n\nOlá, Empresa Avaliacao ME! O serviço da sua ordem de serviço OS-2026-701 foi concluído e o equipamento está pronto para retirada em Lab Sigma.\n\nNúmero da OS\n\nOS-2026-701\n\nStatus\n\nPronta para retirada\n\nPor favor, entre em contato com Lab Sigma para combinar a retirada do equipamento. Obrigado pela confiança!",
  },
  {
    status: "delivered",
    req: "REQ-SOEMAIL-052",
    subject: "OS OS-2026-701 — equipamento entregue",
    body: "Equipamento entregue\n\n\nCONFIRMAÇÃO DE ENTREGA\n\nOlá, Empresa Avaliacao ME! Confirmamos que o equipamento da ordem de serviço OS-2026-701 foi entregue com sucesso. Este é o seu comprovante de entrega.\n\nNúmero da OS\n\nOS-2026-701\n\nStatus\n\nEntregue ao cliente\n\nAgradecemos pela confiança em Lab Sigma. Se precisar de qualquer assistência adicional, não hesite em nos contatar.",
  },
  {
    status: "closed",
    req: "REQ-SOEMAIL-053",
    subject: "OS OS-2026-701 — OS encerrada",
    body: "OS encerrada\n\n\nORDEM DE SERVIÇO ENCERRADA\n\nOlá, Empresa Avaliacao ME! A ordem de serviço OS-2026-701 foi formalmente encerrada por Lab Sigma.\n\nNúmero da OS\n\nOS-2026-701\n\nStatus\n\nEncerrada\n\nObrigado por escolher Lab Sigma. Estamos à disposição para atendê-lo em futuras necessidades.",
  },
  {
    status: "canceled",
    req: "REQ-SOEMAIL-061",
    subject: "OS OS-2026-701 — OS cancelada",
    body: "OS cancelada\n\n\nORDEM DE SERVIÇO CANCELADA\n\nOlá, Empresa Avaliacao ME! Informamos que a ordem de serviço OS-2026-701 foi cancelada por Lab Sigma.\n\nNúmero da OS\n\nOS-2026-701\n\nStatus\n\nCancelada\n\nSe você tiver dúvidas sobre o cancelamento, entre em contato com Lab Sigma. Agradecemos a sua compreensão.",
  },
  {
    status: "warranty_return",
    req: "REQ-SOEMAIL-062",
    subject: "OS OS-2026-701 — retorno em garantia",
    body: "Retorno em garantia\n\n\nORDEM DE SERVIÇO EM RETORNO DE GARANTIA\n\nOlá, Empresa Avaliacao ME! Informamos que a ordem de serviço OS-2026-701 entrou no processo de retorno em garantia em Lab Sigma.\n\nNúmero da OS\n\nOS-2026-701\n\nStatus\n\nRetorno em garantia\n\nNossa equipe irá avaliar o equipamento e entrar em contato com você em breve. Se tiver dúvidas, entre em contato com Lab Sigma.",
  },
];

function renderStatus(
  status: ServiceOrderEmailStatus,
  brand: typeof BRAND | undefined,
  plainText: boolean,
) {
  return render(
    ServiceOrderStatusEmail({
      status,
      brand,
      serviceOrderNumber: SERVICE_ORDER_NUMBER,
      customerName: CUSTOMER_NAME,
    }),
    { plainText },
  );
}

describe("service-order status emails", () => {
  it("covers every status that sends an email, and only those", () => {
    expect(SERVICE_ORDER_EMAIL_STATUSES.toSorted()).toEqual(
      EXPECTED.map((row) => row.status).toSorted(),
    );
    expect(
      SERVICE_ORDER_STATUSES.filter(
        (status) => !sendsServiceOrderStatusEmail(status),
      ),
    ).toEqual([
      "opened",
      "awaiting_quote_approval",
      "quote_approved",
      "quote_rejected",
    ]);
  });

  describe.each(EXPECTED)("$req $status", ({ status, req, subject, body }) => {
    it("renders the pinned copy with the lab brand", async () => {
      const text = await renderStatus(status, BRAND, true);
      expect(text).toContain(body);
      expect(text).toContain(CUSTOMER_NAME);
      expect(text).toContain(SERVICE_ORDER_NUMBER);
      expect(text).toContain("Lab Sigma");
    });

    it("shows the vocabulary's label in the detail row", async () => {
      const text = await renderStatus(status, BRAND, true);
      expect(text).toContain(SERVICE_ORDER_STATUS.label(status));
    });

    it("speaks as the platform without a brand", async () => {
      const text = await renderStatus(status, undefined, true);
      expect(text).toContain(body.replaceAll("Lab Sigma", "CalibraFácil"));
    });

    it("names its requirement and its subject", () => {
      expect(serviceOrderStatusEmailRequirement(status)).toBe(req);
      expect(serviceOrderStatusEmailSubject(status, SERVICE_ORDER_NUMBER)).toBe(
        subject,
      );
    });

    it("puts the preview line in the pre-header of the HTML", async () => {
      const html = await renderStatus(status, BRAND, false);
      expect(html).toContain(`>OS ${SERVICE_ORDER_NUMBER} — `);
    });
  });
});
