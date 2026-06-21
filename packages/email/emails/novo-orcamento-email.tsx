/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { ServiceOrderEmailLayout } from "./service-order-email-layout";
import type { EmailBrand } from "./components/email-layout";
import {
  EmailCard,
  Title,
  Paragraph,
  DetailBox,
  DetailRow,
  ActionButton,
  LinkFallback,
  Eyebrow,
} from "./components/email-layout";
import { Section, Text } from "@react-email/components";
import { formatMoney } from "@calibra-facil/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single quote item — mirrors serviceOrderQuoteItem columns needed for email.
 *
 * REQ-SOEMAIL-022: "grouped by type (peças / serviços / opcionais)".
 * The type grouping mirrors calculatePricedItems in service-order-workflow.ts:
 *   Serviços: "service" | "external_service" | "other" | "evaluation_fee"
 *   Peças:    "part"
 *   Opcionais: "freight" | "discount"
 */
export interface NovoOrcamentoEmailItem {
  id: number;
  type: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  totalPriceCents: number;
}

export interface NovoOrcamentoEmailProps {
  /** White-label brand for the sending lab. */
  brand?: EmailBrand;

  // ---- REQ-SOEMAIL-021: Header fields ----

  /** OS number, e.g. "OS-2026-001". */
  serviceOrderNumber: string;
  /** Customer name (Razão Social). */
  customerName: string;
  /** Customer CNPJ/CPF (taxId). */
  customerTaxId?: string | null;
  /** Asset manufacturer / brand. */
  assetManufacturer?: string | null;
  /** Asset model. */
  assetModel?: string | null;
  /** Asset inventory code (tag / código do cliente). */
  assetInventoryCode?: string | null;
  /** Intake (entrada) date, pre-formatted as a pt-BR string e.g. "19/06/2026". */
  intakeDate: string;
  /** Asset serial number. */
  assetSerialNumber?: string | null;
  /**
   * REQ-SOEMAIL-025: instrument-agnostic spec rows, taken generically from
   * `serviceOrderAssetSnapshot.displaySpecs` (`[{label,value}]`). Rendered
   * as-is — NO hardcoded weighing fields ("Cap/Div"/"Portaria"). When empty
   * or absent the spec section is omitted, so the email is correct for any
   * instrument type (balança, termômetro, paquímetro, manômetro, …).
   */
  displaySpecs?: { label: string; value: string }[] | null;
  /** Claimed defect / problem description. */
  claimedDefect: string;

  // ---- REQ-SOEMAIL-022: Line items + persisted totals [HIGH RISK] ----

  /**
   * All quote items. Rendered grouped by type.
   * The template MUST NOT recompute totals from items — totals come from
   * the persisted *Cents fields below (REQ-SOEMAIL-022).
   */
  items: NovoOrcamentoEmailItem[];

  /**
   * Persisted subtotal for services — from serviceOrderQuote.subtotalServicesCents.
   * DO NOT recompute in the template.
   */
  subtotalServicesCents: number;

  /**
   * Persisted subtotal for parts — from serviceOrderQuote.subtotalPartsCents.
   * DO NOT recompute in the template.
   */
  subtotalPartsCents: number;

  /**
   * Persisted freight total — from serviceOrderQuote.freightCents.
   * DO NOT recompute in the template.
   */
  freightCents: number;

  /**
   * Persisted discount total — from serviceOrderQuote.discountCents.
   * DO NOT recompute in the template.
   */
  discountCents: number;

  /**
   * Persisted grand total — from serviceOrderQuote.totalCents.
   * DO NOT recompute in the template.
   */
  totalCents: number;

  // ---- REQ-SOEMAIL-023: Approval URL [HIGH RISK] ----

  /**
   * Full portal approval URL (already composed by the caller):
   *   `${PORTAL_APP_URL}/service-order-access/${token}`
   *
   * The token is the one returned by createPublicServiceOrderAccessToken
   * inside sendServiceOrderQuote. The caller must NOT mint a new token.
   *
   * REQ-SOEMAIL-023: internalNotes MUST NOT appear — there is no such prop.
   */
  approvalUrl: string;
}

// ---------------------------------------------------------------------------
// Item type grouping
// (mirrors calculatePricedItems in apps/api/src/lib/service-order-workflow.ts)
// ---------------------------------------------------------------------------

/** Items that count as "Serviços". */
const SERVICE_TYPES = new Set([
  "service",
  "external_service",
  "other",
  "evaluation_fee",
]);

/** Items that count as "Peças". */
const PART_TYPES = new Set(["part"]);

/** Items that count as "Opcionais" (frete + desconto). */
const OPTIONAL_TYPES = new Set(["freight", "discount"]);

function groupItems(items: NovoOrcamentoEmailItem[]): {
  services: NovoOrcamentoEmailItem[];
  parts: NovoOrcamentoEmailItem[];
  optionals: NovoOrcamentoEmailItem[];
} {
  const services: NovoOrcamentoEmailItem[] = [];
  const parts: NovoOrcamentoEmailItem[] = [];
  const optionals: NovoOrcamentoEmailItem[] = [];

  for (const item of items) {
    if (SERVICE_TYPES.has(item.type)) {
      services.push(item);
    } else if (PART_TYPES.has(item.type)) {
      parts.push(item);
    } else if (OPTIONAL_TYPES.has(item.type)) {
      optionals.push(item);
    }
    // unknown types are silently omitted from the customer email
  }

  return { services, parts, optionals };
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

// REQ-SOEMAIL-024: BRL from integer cents using formatMoney from @calibra-facil/shared.
// formatMoney(cents) uses Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
// which produces "R$ 1.460,00" for 146000 — no float drift.
function brl(cents: number): string {
  return formatMoney(cents);
}

interface ItemRowProps {
  item: NovoOrcamentoEmailItem;
}

function ItemRow({ item }: ItemRowProps) {
  return (
    <Section className="mb-[8px]">
      <Text className="m-0 font-sans text-[14px] font-[500] leading-[1.4] text-fg">
        {item.description}
      </Text>
      <Text className="m-0 font-sans text-[13px] font-[420] leading-[1.4] text-fg-3">
        {item.quantity} {item.unit} × {brl(item.unitPriceCents)} ={" "}
        <span className="font-bold text-fg">{brl(item.totalPriceCents)}</span>
      </Text>
    </Section>
  );
}

interface ItemGroupProps {
  label: string;
  items: NovoOrcamentoEmailItem[];
  subtotal: number;
}

function ItemGroup({ label, items, subtotal }: ItemGroupProps) {
  if (items.length === 0) return null;
  return (
    <Section className="mb-4">
      <Text className="m-0 mb-2 font-sans text-[11px] font-bold uppercase leading-[1.5] tracking-[0.08em] text-fg-3">
        {label}
      </Text>
      {items.map((item) => (
        <ItemRow key={item.id} item={item} />
      ))}
      <Text className="m-0 mt-2 border-t border-t-[rgba(0,0,0,0.06)] pt-2 text-right font-sans text-[13px] font-bold leading-[1.4] text-fg">
        Subtotal: {brl(subtotal)}
      </Text>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Main template
// ---------------------------------------------------------------------------

/**
 * "Novo Orçamento" customer-facing email (mini-spec C).
 *
 * REQ-SOEMAIL-021: header with OS number, customer name, CNPJ/CPF,
 * brand/model/code, intake date, capacity/division, serial, portaria, defect.
 * REQ-SOEMAIL-022: items grouped by type (Serviços / Peças / Opcionais) with
 * quantity, unit price, line total; subtotals and totalCents from persisted
 * values — NOT recomputed in JSX.
 * REQ-SOEMAIL-023: highlighted approval URL from captured public access token;
 * no internalNotes (no such prop on this component).
 * REQ-SOEMAIL-024: BRL from integer cents via formatMoney — no float drift.
 */
export function NovoOrcamentoEmail({
  brand,
  serviceOrderNumber,
  customerName,
  customerTaxId,
  assetManufacturer,
  assetModel,
  assetInventoryCode,
  intakeDate,
  assetSerialNumber,
  displaySpecs,
  claimedDefect,
  items,
  subtotalServicesCents,
  subtotalPartsCents,
  freightCents,
  discountCents,
  totalCents,
  approvalUrl,
}: NovoOrcamentoEmailProps) {
  const labName = brand?.name ?? "CalibraFácil";

  const { services, parts, optionals } = groupItems(items);

  const assetDesc = [assetManufacturer, assetModel].filter(Boolean).join(" ");
  const previewText = `Orçamento ${serviceOrderNumber} — ${assetDesc || "equipamento"} — ${brl(totalCents)}`;

  const hasOptionals = freightCents > 0 || discountCents > 0 || optionals.length > 0;

  return (
    <ServiceOrderEmailLayout previewText={previewText} brand={brand}>
      <EmailCard brand={brand}>
        <Eyebrow>Orçamento #{serviceOrderNumber}</Eyebrow>
        <Title>Orçamento disponível para aprovação</Title>
        <Paragraph>
          Olá, {customerName}! {labName} preparou um orçamento para o seu
          equipamento. Confira os detalhes abaixo e clique no botão para aprovar
          ou recusar.
        </Paragraph>

        {/* REQ-SOEMAIL-021: Header fields */}
        <DetailBox>
          <DetailRow label="Número da OS" value={serviceOrderNumber} />
          <DetailRow label="Cliente" value={customerName} />
          {customerTaxId ? (
            <DetailRow label="CNPJ / CPF" value={customerTaxId} />
          ) : null}
          {(assetManufacturer ?? assetModel) ? (
            <DetailRow
              label="Equipamento"
              value={
                [assetManufacturer, assetModel].filter(Boolean).join(" ")
              }
            />
          ) : null}
          {assetInventoryCode ? (
            <DetailRow label="Código / Tag" value={assetInventoryCode} />
          ) : null}
          <DetailRow label="Data de entrada" value={intakeDate} />
          {assetSerialNumber ? (
            <DetailRow label="Número de série" value={assetSerialNumber} />
          ) : null}
          {/* REQ-SOEMAIL-025: instrument-agnostic spec rows from displaySpecs —
              no hardcoded "Cap/Div"/"Portaria"; the lab curates these per
              instrument type. */}
          {(displaySpecs ?? []).map((spec, index) => (
            <DetailRow
              key={`spec-${index}-${spec.label}`}
              label={spec.label}
              value={spec.value}
            />
          ))}
          <DetailRow label="Defeito relatado" value={claimedDefect} />
        </DetailBox>

        {/* REQ-SOEMAIL-022: Line items grouped by type */}
        <Section className="mb-6 rounded-[10px] bg-bg px-5 py-5 text-left shadow-sm">
          <Text className="m-0 mb-4 font-sans text-[15px] font-bold leading-[1.4] text-fg">
            Itens do orçamento
          </Text>

          {/* Serviços: service | external_service | other | evaluation_fee */}
          <ItemGroup
            label="Serviços"
            items={services}
            subtotal={subtotalServicesCents}
          />

          {/* Peças: part */}
          <ItemGroup
            label="Peças"
            items={parts}
            subtotal={subtotalPartsCents}
          />

          {/* Opcionais: freight | discount (from persisted freightCents / discountCents) */}
          {hasOptionals ? (
            <Section className="mb-4">
              <Text className="m-0 mb-2 font-sans text-[11px] font-bold uppercase leading-[1.5] tracking-[0.08em] text-fg-3">
                Opcionais
              </Text>
              {optionals.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
              {freightCents > 0 ? (
                <Text className="m-0 mt-1 font-sans text-[13px] font-[420] leading-[1.4] text-fg-3">
                  Frete: {brl(freightCents)}
                </Text>
              ) : null}
              {discountCents > 0 ? (
                <Text className="m-0 mt-1 font-sans text-[13px] font-[420] leading-[1.4] text-fg-3">
                  Desconto: -{brl(discountCents)}
                </Text>
              ) : null}
            </Section>
          ) : null}

          {/* REQ-SOEMAIL-022: Total from persisted totalCents — NOT recomputed */}
          <Section className="mt-2 border-t-2 border-t-brand pt-3">
            <Text className="m-0 text-right font-sans text-[18px] font-bold leading-[1.3] text-fg">
              Total: {brl(totalCents)}
            </Text>
          </Section>
        </Section>

        {/* REQ-SOEMAIL-023: Highlighted approval URL [HIGH RISK] */}
        <Paragraph>
          Clique no botão abaixo para visualizar e aprovar o orçamento no
          portal. O link é exclusivo para esta ordem de serviço.
        </Paragraph>

        <ActionButton href={approvalUrl}>Aprovar Orçamento</ActionButton>
        <LinkFallback url={approvalUrl} />
      </EmailCard>
    </ServiceOrderEmailLayout>
  );
}
