import type { CommercialOfferPreviewInput } from "@calibra-facil/schemas";
import {
  getCommercialOfferLabel,
  getCommercialRenewalMode,
  isPlanBearingOffer,
  type CommercialOfferItemType,
  type CommercialOfferKind,
  type CommercialPaymentMethod,
  type CommercialProviderMode,
} from "@calibra-facil/shared";

export interface NormalizedCommercialOfferItem {
  type: CommercialOfferItemType;
  label: string;
  description?: string;
  quantity: number;
  unitAmount: number;
  totalAmount: number;
}

export interface CommercialOfferPreviewResult {
  providerMode: CommercialProviderMode;
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  recurringAmount: number | null;
  issueable: boolean;
  warnings: string[];
  normalizedSnapshot: {
    kind: CommercialOfferKind;
    basePlanId: CommercialOfferPreviewInput["basePlanId"];
    billingCycle: CommercialOfferPreviewInput["billingCycle"];
    contractTermMonths: number | null;
    paymentMethods: CommercialPaymentMethod[];
    dueDate: Date;
    offerExpiresAt: Date | null;
    customerVisibleDescription: string | null;
    internalNotes: string | null;
    items: NormalizedCommercialOfferItem[];
    subtotalAmount: number;
    discountAmount: number;
    totalAmount: number;
    recurringAmount: number | null;
    providerMode: CommercialProviderMode;
    renewalMode: ReturnType<typeof getCommercialRenewalMode>;
  };
}

function parseDateInput(input?: string) {
  if (!input) return null;
  const value = new Date(input);
  return Number.isNaN(value.getTime()) ? null : value;
}

function buildDefaultItems(
  input: CommercialOfferPreviewInput,
): NormalizedCommercialOfferItem[] {
  if (input.items.length > 0) {
    return input.items.map((item) => ({
      ...item,
      quantity: item.quantity,
      totalAmount: item.unitAmount * item.quantity,
    }));
  }

  return [
    {
      type: input.kind === "SETUP_FEE" ? "SETUP_FEE" : "PLAN",
      label:
        input.kind === "SETUP_FEE"
          ? "Taxa de implantacao"
          : getCommercialOfferLabel(input.kind),
      quantity: 1,
      unitAmount: input.negotiatedAmount,
      totalAmount: input.negotiatedAmount,
    },
  ];
}

function resolveProviderMode(
  kind: CommercialOfferKind,
  methods: CommercialPaymentMethod[],
  warnings: string[],
): CommercialProviderMode {
  if (kind === "PLAN_RECURRING") {
    if (methods.includes("CREDIT_CARD") && methods.length > 1) {
      warnings.push(
        "Planos recorrentes com cartao devem ser emitidos apenas com cartao no modelo de checkout recorrente.",
      );
      return "CHECKOUT";
    }

    if (methods.includes("CREDIT_CARD")) {
      return "CHECKOUT";
    }

    if (methods.length > 1) {
      warnings.push(
        "Planos recorrentes por PIX/boleto devem usar um unico meio de pagamento por oferta.",
      );
    }

    return "SUBSCRIPTION";
  }

  if (methods.length === 1 && methods[0] !== "CREDIT_CARD") {
    return "PAYMENT";
  }

  if (methods.length === 1 && methods[0] === "CREDIT_CARD") {
    return "PAYMENT";
  }

  return "CHECKOUT";
}

export function previewCommercialOffer(
  input: CommercialOfferPreviewInput,
): CommercialOfferPreviewResult {
  const warnings: string[] = [];

  if (input.kind !== "SETUP_FEE" && (input.setupFeeAmount ?? 0) > 0) {
    warnings.push(
      "A taxa de implantacao deve ser emitida como oferta separada no modelo comercial definido.",
    );
  }

  if (isPlanBearingOffer(input.kind) && !input.basePlanId) {
    warnings.push("Ofertas de plano exigem um plano base.");
  }

  if (input.kind === "PLAN_RECURRING" && !input.billingCycle) {
    warnings.push("Ofertas recorrentes exigem ciclo de cobranca.");
  }

  if (input.kind === "SETUP_FEE" && input.billingCycle) {
    warnings.push("Taxa de implantacao nao deve possuir ciclo recorrente.");
  }

  const items = buildDefaultItems(input);
  const subtotalAmount = items.reduce((acc, item) => acc + item.totalAmount, 0);
  const discountAmount = input.discountAmount ?? 0;
  const totalAmount = Math.max(0, subtotalAmount - discountAmount);
  const providerMode = resolveProviderMode(
    input.kind,
    input.paymentMethods,
    warnings,
  );
  const dueDate =
    parseDateInput(input.dueDate) ?? new Date(Date.now() + 3 * 86400000);
  const offerExpiresAt = parseDateInput(input.offerExpiresAt);
  const recurringAmount =
    input.kind === "PLAN_RECURRING" ? input.negotiatedAmount : null;

  return {
    providerMode,
    subtotalAmount,
    discountAmount,
    totalAmount,
    recurringAmount,
    issueable:
      warnings.length === 0 &&
      totalAmount >= 0 &&
      (!isPlanBearingOffer(input.kind) || Boolean(input.basePlanId)) &&
      (input.kind !== "PLAN_RECURRING" || Boolean(input.billingCycle)),
    warnings,
    normalizedSnapshot: {
      kind: input.kind,
      basePlanId: input.basePlanId,
      billingCycle:
        input.kind === "PLAN_UPFRONT"
          ? (input.billingCycle ?? "YEARLY")
          : input.billingCycle,
      contractTermMonths: input.contractTermMonths ?? null,
      paymentMethods: input.paymentMethods,
      dueDate,
      offerExpiresAt,
      customerVisibleDescription: input.customerVisibleDescription ?? null,
      internalNotes: input.internalNotes ?? null,
      items,
      subtotalAmount,
      discountAmount,
      totalAmount,
      recurringAmount,
      providerMode,
      renewalMode: getCommercialRenewalMode(input.kind),
    },
  };
}
