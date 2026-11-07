import { invalid, notFound } from "../../lib/domain-errors";

// The refusals several service-order commands and routes share, with the
// pt-BR text clients already show.

export function serviceOrderNotFound() {
  return notFound("service_order_not_found", "OS nao encontrada");
}

export function serviceOrderInvalidTransition() {
  return invalid(
    "service_order_invalid_transition",
    "Transicao de status invalida",
  );
}

// One generic refusal for "unknown" and "belongs to another tenant" ids.
export function serviceOrderTechnicianRefused() {
  return invalid(
    "technician_not_found",
    "Tecnico nao encontrado ou sem permissao",
  );
}

export function serviceOrderSourceRefused() {
  return invalid(
    "service_order_source_not_found",
    "OS de origem nao encontrada",
  );
}

export function serviceOrderPdfUnavailable() {
  return notFound("service_order_pdf_unavailable", "PDF indisponivel");
}

export function serviceOrderQuoteNotFound() {
  return notFound("service_order_quote_not_found", "Orcamento nao encontrado");
}
