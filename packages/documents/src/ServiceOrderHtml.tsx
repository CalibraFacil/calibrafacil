/** @jsxImportSource react */
export type ServiceOrderDocumentItem = {
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  totalPriceCents: number;
  type?: string;
};

export type ServiceOrderDocumentData = {
  serviceOrderNumber: string;
  openedAt: Date | string;
  lab: {
    name: string;
    cnpj?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    logoUrl?: string | null;
    /**
     * Permissionária authorization number + UF (e.g. "0123/RS") from the RBMLQ-I.
     * Mandatory OS content for legal-metrology repairs (Port. Inmetro 65/2015); the
     * repairer's own seal also carries it. Optional so non-regulated docs omit it.
     */
    authorizationNumber?: string | null;
  };
  unit?: { name: string | null };
  customer: {
    name: string;
    taxId?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
  };
  asset: {
    name: string;
    type?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    serialNumber?: string | null;
    patrimonyNumber?: string | null;
    tag?: string | null;
    observedIdentification?: string | null;
    /**
     * Blueprint-driven instrument specs, ordered for print (capacity/resolution for a
     * balança, pressure range for a manômetro, etc.). Frozen at intake; falls back to
     * the live asset-type blueprint for snapshots created before migration 0056.
     */
    specs?: Array<{ label: string; value: string }>;
    /**
     * Legal-metrology regime of the instrument. The marca-de-selagem / Marca de Reparo blocks
     * render IFF `metrologyRegime === 'LEGAL'` (Inmetro / RBMLQ-I legal control).
     */
    metrologyRegime?: "INDUSTRIAL" | "LEGAL" | "UNKNOWN";
  };
  intake: {
    claimedDefect: string;
    intakeCondition: string;
    accessories?: string | null;
    invoiceRemittanceNumber?: string | null;
    invoiceRemittanceKey?: string | null;
    carrierName?: string | null;
    thirdPartyName?: string | null;
    removedSealingMarkNumber?: string | null;
    affixedSealingMarkNumber?: string | null;
    inmetroRepairMarkNumber?: string | null;
    clientVisibleNotes?: string | null;
    internalNotes?: string | null;
    terms?: string | null;
  };
  requestedServices?: string[];
  /** How the instrument was received (Balcão / Transportadora / …). */
  intakeType?: string | null;
  /** External / in-loco order: the technician travels to the client. */
  isExternalService?: boolean;
  /** When the technician actually started the service/budget work. */
  serviceStartedAt?: Date | string | null;
  /** Source/previous service order this one was derived from (e.g. recalibration). */
  previousServiceOrderNumber?: string | null;
  /** Responsible technician of the source/previous service order. */
  previousTechnicianName?: string | null;
  qrCodeDataUrl?: string | null;
  publicUrl?: string | null;
  receiverName?: string | null;
  signatureDataUrl?: string | null;
};

export type ServiceOrderTagData = {
  serviceOrderNumber: string;
  customerName: string;
  assetName: string;
  serialNumber?: string | null;
  patrimonyNumber?: string | null;
  openedAt: Date | string;
  qrCodeDataUrl?: string | null;
};

export type ServiceOrderQuoteData = ServiceOrderDocumentData & {
  quote: {
    quoteNumber: string;
    version: number;
    validUntil?: Date | string | null;
    paymentTerms?: string | null;
    deliveryEstimate?: string | null;
    warrantyTerms?: string | null;
    diagnosis?: string | null;
    clientMessage?: string | null;
    items: ServiceOrderDocumentItem[];
    subtotalServicesCents: number;
    subtotalPartsCents: number;
    discountCents: number;
    freightCents: number;
    totalCents: number;
  };
};

export type ServiceOrderSignatureBlock = {
  signerName: string;
  signedAt?: Date | string | null;
  dataUrl?: string | null;
};

export type ServiceOrderDeliveryReceiptData = ServiceOrderDocumentData & {
  delivery: {
    documentNumber: string;
    version: number;
    issuedAt?: Date | string | null;
    deliveredAt?: Date | string | null;
    deliveredToName?: string | null;
    deliveredToDocument?: string | null;
    deliveryMethod?: string | null;
    deliveryNotes?: string | null;
    inmetroRepairMarkNumber?: string | null;
    inmetroRepairMarkIssuedAt?: Date | string | null;
    technicianSignature?: ServiceOrderSignatureBlock | null;
    clientSignature?: ServiceOrderSignatureBlock | null;
  };
  execution: {
    servicePerformed?: string | null;
    partsUsedSummary?: string | null;
    technicalNotes?: string | null;
    result?: string | null;
    finishedAt?: Date | string | null;
    items: ServiceOrderDocumentItem[];
    subtotalServicesCents: number;
    subtotalPartsCents: number;
    totalCents: number;
  };
};

const pageStyles = `
  @page { size: A4; margin: 6mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; line-height: 1.1; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .copy-tag { margin-bottom: 0.45mm; font-size: 7.2pt; font-weight: 700; text-transform: uppercase; }
  .header { width: 100%; border-collapse: collapse; margin-bottom: 0.7mm; }
  .header td { border: 1px solid #000; padding: 0.75mm 1mm; vertical-align: top; }
  .title { margin: 0; font-size: 11pt; line-height: 1; font-weight: 700; }
  .meta-title { font-size: 6.2pt; font-weight: 700; text-transform: uppercase; margin-bottom: 0.25mm; }
  .os-number { font-size: 10.5pt; font-weight: 700; font-family: "Courier New", monospace; margin-bottom: 0.25mm; }
  .meta-line { margin: 0; font-size: 6.9pt; }
  .header-info { margin-top: 0.35mm; font-size: 6.8pt; line-height: 1.08; }
  .header-info-line { margin: 0.05mm 0; }
  .header-brand { display: flex; align-items: center; gap: 2mm; }
  .lab-logo { max-height: 13mm; max-width: 42mm; object-fit: contain; flex: 0 0 auto; }
  .lab-copy .lab-logo { max-height: 10mm; max-width: 34mm; }
  .section-title { margin: 0.7mm 0 0.35mm; padding: 0.35mm 0.7mm; border: 1px solid #000; font-size: 7.1pt; font-weight: 700; text-transform: uppercase; background: #f2f2f2; }
  table.form-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 0.7mm; }
  .form-table td, .form-table th { border: 1px solid #000; padding: 0.55mm 0.85mm; vertical-align: top; }
  .form-table th { text-align: left; font-size: 6.8pt; font-weight: 700; text-transform: uppercase; background: #f2f2f2; }
  .cell-label { display: block; font-size: 6.1pt; font-weight: 700; text-transform: uppercase; margin-bottom: 0.15mm; }
  .cell-value { display: block; min-height: 1.8mm; white-space: pre-wrap; overflow-wrap: anywhere; }
  .cell-value-tall { min-height: 6.5mm; }
  .notes-box { border: 1px solid #000; min-height: 6mm; padding: 0.65mm 0.85mm; white-space: pre-wrap; margin-bottom: 0.55mm; }
  .writing-box { border: 1px solid #000; height: 12mm; padding: 0; margin-bottom: 0.6mm; background: repeating-linear-gradient(to bottom, #fff 0, #fff 4.6mm, #000 4.6mm, #000 4.72mm); }
  .writing-box.compact { height: 7mm; }
  .writing-box.observations { height: 9mm; }
  .parts-table td { height: 4.2mm; }
  .signature-table td { height: 5.5mm; }
  .fine-print { font-size: 7.5pt; }
  .compact-list { margin: 0; padding-left: 3.5mm; }
  .compact-list li { margin: 0.65mm 0; }
  .checkbox-line { display: inline-block; margin-right: 1.8mm; white-space: nowrap; }
  .checkbox { display: inline-block; width: 2.35mm; height: 2.35mm; border: 1px solid #000; margin-right: 0.55mm; vertical-align: -0.45mm; text-align: center; font-size: 5pt; font-weight: 700; line-height: 2.2mm; overflow: hidden; }
  /* The lab via carries every working field plus roomy ruled handwriting areas. With the
     intake-method/address/service-start fields it runs slightly past one A4, so scale the via
     down uniformly to fit while filling the page (matches the approved preview proportions). */
  .lab-copy { font-size: 7.45pt; zoom: 0.9; }
  .lab-copy .header td { padding: 0.55mm 0.8mm; }
  .lab-copy .title { font-size: 10.2pt; }
  .lab-copy .os-number { font-size: 9.6pt; }
  .lab-copy .section-title { margin-top: 0.45mm; }
  .lab-copy table.form-table { margin-bottom: 0.45mm; }
  .lab-copy .form-table td, .lab-copy .form-table th { padding: 0.45mm 0.7mm; }
  .lab-copy .cell-label { font-size: 5.8pt; }
  .lab-copy .cell-value { min-height: 1.45mm; }
  .lab-copy .cell-value-tall { min-height: 6.5mm; }
  .lab-copy .notes-box { min-height: 5mm; }
  /* Lab-copy handwriting areas: 6mm rule spacing × 4 lines = 24mm. */
  .lab-copy .writing-box { height: 18mm; background: repeating-linear-gradient(to bottom, #fff 0, #fff 6mm, #000 6mm, #000 6.12mm); }
  .lab-copy .writing-box.compact { height: 24mm; }
  .lab-copy .writing-box.observations { height: 18mm; }
  .lab-copy .parts-table td { height: 7mm; }
  .lab-copy .signature-table td { height: 4mm; }
  .qr { width: 82px; height: 82px; object-fit: contain; }
  /* Brand block centers in the header cell instead of floating at the top of the
     taller QR column; the QR sits BESIDE the OS metadata (not stacked under it), so
     the header no longer dictates ~14mm of dead space — that spill was what pushed
     the lab via past one A4 on instruments with a full spec blueprint. */
  .header .header-brand-cell { vertical-align: middle; }
  .header-meta { display: flex; justify-content: space-between; align-items: flex-start; gap: 1.6mm; }
  .qr-cell { flex: 0 0 auto; text-align: center; }
  .qr-url { font-size: 5.4pt; line-height: 1.15; overflow-wrap: anywhere; margin-top: 0.5mm; }
  .field { margin: 2px 0; }
  .label { font-weight: 700; }
  table.quote-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .quote-table th, .quote-table td { border-bottom: 1px solid #e5e7eb; padding: 5px; text-align: left; }
  .quote-table th { background: #f3f4f6; font-weight: 700; }
  .num { text-align: right; }
  .total { font-size: 15px; font-weight: 700; }
  .tag { width: 90mm; min-height: 42mm; border: 1px solid #111827; padding: 6mm; display: grid; grid-template-columns: 1fr 24mm; gap: 5mm; }
  .tag-title { font-size: 18px; font-weight: 700; }
  .tag .qr { width: 24mm; height: 24mm; }
  .receipt-page { font-size: 8.2pt; }
  .receipt-page .section-title { margin-top: 1mm; }
  .receipt-total { font-size: 11pt; font-weight: 700; }
  .seal-box { border: 1px dashed #000; min-height: 26mm; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 7pt; font-weight: 700; text-transform: uppercase; }
  .signature-img { display: block; max-width: 60mm; max-height: 12mm; object-fit: contain; margin: 0 auto 1mm; }
  .signature-line { border-top: 1px solid #000; padding-top: 1mm; text-align: center; min-height: 8mm; }
  /* Delivery receipt (revamped): flex header (kills the old equal-height-table
     whitespace) + flex-column page so the open signature lines anchor to the sheet
     foot and the body fills it; degrades gracefully when the items table grows. */
  .receipt-page { font-size: 8.2pt; display: flex; flex-direction: column; min-height: 270mm; }
  .receipt-page .section-title { margin-top: 0.7mm; }
  .receipt-page .form-table td, .receipt-page .form-table th { padding: 0.42mm 0.72mm; }
  .receipt-head { display: flex; align-items: stretch; gap: 2.6mm; border: 1px solid #000; padding: 1.2mm 2.2mm; margin-bottom: 1mm; }
  .receipt-brand { display: flex; align-items: center; gap: 2.6mm; flex: 1 1 auto; }
  .receipt-head .lab-logo { max-height: 12.5mm; max-width: 40mm; object-fit: contain; }
  .receipt-brand-text { display: flex; flex-direction: column; justify-content: center; gap: 0.3mm; }
  .receipt-lab-name { font-size: 10pt; font-weight: 700; line-height: 1.05; }
  .receipt-lab-line { font-size: 6.9pt; line-height: 1.18; }
  .receipt-meta { flex: 0 0 49mm; border-left: 1px solid #000; padding-left: 2.4mm; display: flex; flex-direction: column; justify-content: center; gap: 0.2mm; }
  .receipt-doc-title { font-size: 8.4pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .receipt-doc-sub { font-size: 5.6pt; line-height: 1.1; color: #333; margin: 0.2mm 0 0.3mm; }
  .receipt-meta .os-number { font-size: 11pt; margin: 0; }
  .receipt-meta-row { font-size: 6.7pt; line-height: 1.15; }
  .receipt-qr-wrap { display: flex; align-items: center; gap: 1.8mm; margin-top: 0.7mm; }
  /* 46px (~12mm) put the QR modules under the ~0.4mm reliable laser-print floor for
     a 60+ char URL; 64px (~17mm) keeps error-margin for the portal link. */
  .receipt-qr-wrap .qr { width: 64px; height: 64px; flex: 0 0 auto; }
  .receipt-qr-cap { font-size: 5.9pt; line-height: 1.18; max-width: 29mm; }
  .exec-notes { min-height: 12mm; }
  .num, .receipt-total, .os-number { font-variant-numeric: tabular-nums; }
  .total-strong { background: #f2f2f2; border: 1.4pt solid #000 !important; text-align: right; }
  .total-strong .receipt-total { font-size: 12pt; }
  /* Marca de Reparo paste target: crop-mark corners (not a full box) sized to the
     ~40x7mm label + ~1mm tolerance, so it's an unmistakable placement target and
     not an oversized field people write inside. */
  .seal-cell { text-align: center; vertical-align: middle; width: 50mm; }
  .seal-cap { font-size: 6.4pt; font-weight: 700; line-height: 1.1; }
  .seal-target { position: relative; width: 42mm; height: 8mm; margin: 0.8mm auto; }
  .seal-cm { position: absolute; width: 2.3mm; height: 2.3mm; }
  .seal-cm-tl { top: 0; left: 0; border-top: 0.3mm solid #000; border-left: 0.3mm solid #000; }
  .seal-cm-tr { top: 0; right: 0; border-top: 0.3mm solid #000; border-right: 0.3mm solid #000; }
  .seal-cm-bl { bottom: 0; left: 0; border-bottom: 0.3mm solid #000; border-left: 0.3mm solid #000; }
  .seal-cm-br { bottom: 0; right: 0; border-bottom: 0.3mm solid #000; border-right: 0.3mm solid #000; }
  .seal-dim { font-size: 6pt; color: #555; }
  .seal-note { display: block; font-size: 6.4pt; font-weight: 400; text-transform: none; margin-top: 0.9mm; }
  .seal-section { break-inside: avoid; }
  .ack-line { border: 1px solid #000; padding: 0.8mm 1.2mm; font-size: 7pt; line-height: 1.22; margin: 0.5mm 0; }
  .sign-area { margin-top: auto; display: flex; gap: 18mm; padding-top: 3.5mm; break-inside: avoid; }
  .sign-slot { flex: 1 1 0; min-width: 0; }
  .sign-caption { font-size: 6.7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 1mm; text-align: center; }
  .sign-space { height: 10mm; }
  .sign-img { display: block; max-height: 10mm; max-width: 68mm; object-fit: contain; margin: 0 auto; }
  .sign-rule { width: 100%; border-top: 1px solid #000; }
  .sign-name { font-size: 8.6pt; font-weight: 700; margin-top: 1.2mm; text-align: center; }
  .sign-role { font-size: 7.2pt; line-height: 1.22; text-align: center; }
  .sign-sub { font-size: 6.8pt; text-align: center; }
  .sign-id { margin-top: 3mm; }
  .sign-field { display: flex; align-items: flex-end; gap: 1.6mm; margin-top: 3mm; }
  .sign-field-label { font-size: 7pt; white-space: nowrap; }
  .sign-blank { flex: 1 1 auto; border-bottom: 1px solid #000; height: 3.2mm; }
  .sign-date { display: flex; align-items: flex-end; gap: 1.6mm; font-size: 8pt; margin-top: 3.2mm; letter-spacing: 0.3px; }
  .sign-date-cells { white-space: nowrap; }
`;

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function text(value: unknown, fallback = "-") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

const INTAKE_TYPE_LABELS: Record<string, string> = {
  counter: "Balcão (cliente trouxe)",
  carrier: "Transportadora",
  third_party: "Terceiro",
  internal: "Interno",
  warranty_return: "Retorno de garantia",
};

function intakeTypeLabel(value?: string | null) {
  if (!value) return "-";
  return INTAKE_TYPE_LABELS[value] ?? value;
}

function Field({ label, value }: { label: string; value?: unknown }) {
  return (
    <div className="field">
      <span className="label">{label}: </span>
      <span>{value ? String(value) : "-"}</span>
    </div>
  );
}

function Cell({
  label,
  value,
  fallback,
  tall,
}: {
  label: string;
  value?: unknown;
  fallback?: string;
  tall?: boolean;
}) {
  return (
    <td>
      <span className="cell-label">{label}</span>
      <span className={tall ? "cell-value cell-value-tall" : "cell-value"}>
        {text(value, fallback)}
      </span>
    </td>
  );
}

/**
 * Renders the instrument's blueprint-driven specs as rows of three labeled cells
 * (only fields that have a value). Replaces the old hardcoded weighing rows so the
 * Equipamento section adapts to any asset type. Renders nothing when there are no specs.
 */
function AssetSpecRows({
  specs,
}: {
  specs?: Array<{ label: string; value: string }>;
}) {
  if (!specs || specs.length === 0) return null;
  const rows: Array<Array<{ label: string; value: string }>> = [];
  for (let i = 0; i < specs.length; i += 3) rows.push(specs.slice(i, i + 3));
  return (
    <>
      {rows.map((cells) => (
        <tr key={cells.map((c) => c.label).join("|")}>
          {cells.map((spec) => (
            <Cell key={spec.label} label={spec.label} value={spec.value} />
          ))}
        </tr>
      ))}
    </>
  );
}

function CheckboxLine({
  label,
  checked,
}: {
  label: string;
  checked?: boolean;
}) {
  return (
    <span className="checkbox-line">
      <span className="checkbox">{checked ? "X" : ""}</span>
      {label}
    </span>
  );
}

/**
 * Host shown under the header QR. The full public URL (protocol + UUID path) wraps
 * to two-plus lines nobody types; the QR carries the exact link, the text only needs
 * to say where it leads.
 */
function formatPublicUrlHost(publicUrl?: string | null) {
  if (!publicUrl) return null;
  const match = publicUrl.match(/^https?:\/\/([^/]+)/);
  return match ? match[1] : publicUrl;
}

function Header({ data }: { data: ServiceOrderDocumentData }) {
  return (
    <table className="header">
      <tbody>
        <tr>
          <td className="header-brand-cell" style={{ width: "64%" }}>
            <div className="header-brand">
              {data.lab.logoUrl ? (
                <img
                  className="lab-logo"
                  src={data.lab.logoUrl}
                  alt={data.lab.name}
                />
              ) : null}
              <div>
                <h1 className="title">ORDEM DE SERVIÇO</h1>
                <div className="header-info">
                  <div className="header-info-line">{data.lab.name}</div>
                  <div className="header-info-line">
                    {[data.lab.phone, data.lab.email]
                      .filter(Boolean)
                      .join(" | ") || "-"}
                  </div>
                  <div className="header-info-line">
                    CNPJ: {text(data.lab.cnpj)}
                  </div>
                  <div className="header-info-line">
                    {text(data.lab.address)}
                  </div>
                </div>
              </div>
            </div>
          </td>
          <td style={{ width: "36%" }}>
            <div className="header-meta">
              <div>
                <div className="meta-title">Número da OS</div>
                <div className="os-number">{data.serviceOrderNumber}</div>
                <div className="meta-line">
                  Abertura: {formatDate(data.openedAt)}
                </div>
                <div className="meta-line">
                  Entrada: {formatDate(data.openedAt)}
                </div>
                <div className="meta-line">Previsão: -</div>
              </div>
              {data.qrCodeDataUrl ? (
                <div className="qr-cell">
                  <img className="qr" src={data.qrCodeDataUrl} alt="QR Code" />
                  <div className="qr-url">
                    {formatPublicUrlHost(data.publicUrl)}
                  </div>
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * Balanced delivery-receipt header. Uses flexbox (not a height-matched <table>) so the
 * lab block no longer stretches to the QR column's height and leaves a big blank gap.
 */
const QR_CAPTION =
  "Leia o QR Code para acompanhar a OS e validar a autenticidade no portal.";

function ReceiptHeader({ data }: { data: ServiceOrderDeliveryReceiptData }) {
  const legalMetrology = data.asset.metrologyRegime === "LEGAL";
  const cnpjLine = [
    `CNPJ ${text(data.lab.cnpj)}`,
    data.lab.authorizationNumber
      ? `Autorização RBMLQ-I nº ${data.lab.authorizationNumber}`
      : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  return (
    <div className="receipt-head">
      <div className="receipt-brand">
        {data.lab.logoUrl ? (
          <img
            className="lab-logo"
            src={data.lab.logoUrl}
            alt={data.lab.name}
          />
        ) : null}
        <div className="receipt-brand-text">
          <div className="receipt-lab-name">{data.lab.name}</div>
          <div className="receipt-lab-line">
            {[data.lab.phone, data.lab.email].filter(Boolean).join("  ·  ") ||
              "-"}
          </div>
          <div className="receipt-lab-line">{cnpjLine}</div>
          <div className="receipt-lab-line">{text(data.lab.address)}</div>
        </div>
      </div>
      <div className="receipt-meta">
        <div className="receipt-doc-title">Comprovante de Entrega</div>
        {legalMetrology ? (
          <div className="receipt-doc-sub">
            Instrumento sujeito a controle metrológico legal — reparo por
            oficina permissionária (Port. Inmetro 65/2015).
          </div>
        ) : null}
        <div className="os-number">{data.serviceOrderNumber}</div>
        <div className="receipt-meta-row">
          Documento {data.delivery.documentNumber} · v{data.delivery.version}
        </div>
        <div className="receipt-meta-row">
          Emissão: {formatDate(data.delivery.issuedAt)}
        </div>
        <div className="receipt-meta-row">
          Entrega: {formatDate(data.delivery.deliveredAt)}
        </div>
        {data.qrCodeDataUrl ? (
          <div className="receipt-qr-wrap">
            <img className="qr" src={data.qrCodeDataUrl} alt="QR Code" />
            <div className="receipt-qr-cap">{QR_CAPTION}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Open signature line (no enclosing box): an area to sign, the rule, the signer's
 * printed name, the role, and a free handwritten date. Spans half the page width so
 * the técnico / cliente pair fills the foot of the sheet.
 */
function SignatureSlot({
  caption,
  role,
  sub,
  idFields,
  signature,
}: {
  caption: string;
  role: string;
  sub?: string | null;
  idFields?: string[];
  signature?: ServiceOrderSignatureBlock | null;
}) {
  return (
    <div className="sign-slot">
      <div className="sign-caption">{caption}</div>
      {signature?.dataUrl ? (
        <img className="sign-img" src={signature.dataUrl} alt={caption} />
      ) : (
        <div className="sign-space" />
      )}
      <div className="sign-rule" />
      <div className="sign-name">{text(signature?.signerName, "")}</div>
      <div className="sign-role">{role}</div>
      {sub ? <div className="sign-sub">{sub}</div> : null}
      {idFields && idFields.length > 0 ? (
        <div className="sign-id">
          {idFields.map((label) => (
            <div className="sign-field" key={label}>
              <span className="sign-field-label">{label}</span>
              <span className="sign-blank" />
            </div>
          ))}
        </div>
      ) : null}
      <div className="sign-date">
        <span className="sign-field-label">Data</span>
        <span className="sign-date-cells">____ / ____ / ________</span>
      </div>
    </div>
  );
}

function DeliveryReceiptCopy({
  data,
  copy,
}: {
  data: ServiceOrderDeliveryReceiptData;
  copy: "client" | "lab";
}) {
  const sealNumber =
    data.delivery.inmetroRepairMarkNumber ??
    data.intake.inmetroRepairMarkNumber;
  const receivedBy =
    [data.delivery.deliveredToName, data.delivery.deliveredToDocument]
      .filter(Boolean)
      .join("  ·  ") || null;
  const requestedService = (data.requestedServices ?? []).join(", ") || null;
  const serviceLocation = data.isExternalService
    ? (data.customer.address ?? "No cliente (in loco)")
    : "No laboratório";
  return (
    <section className="page receipt-page">
      <div className="copy-tag">
        {copy === "client" ? "Via do cliente" : "Via do laboratório"}
      </div>
      <ReceiptHeader data={data} />

      <div className="section-title">Cliente</div>
      <table className="form-table">
        <tbody>
          <tr>
            <Cell label="Razão social / Nome" value={data.customer.name} />
            <Cell label="CNPJ / CPF" value={data.customer.taxId} />
          </tr>
          <tr>
            <Cell label="Telefone" value={data.customer.phone} />
            <Cell label="E-mail" value={data.customer.email} />
          </tr>
          <tr>
            <td colSpan={2}>
              <span className="cell-label">Endereço</span>
              <span className="cell-value">{text(data.customer.address)}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="section-title">Equipamento</div>
      <table className="form-table">
        <tbody>
          <tr>
            <Cell label="Equipamento" value={data.asset.name} />
            <Cell label="Fabricante" value={data.asset.manufacturer} />
            <Cell label="Modelo" value={data.asset.model} />
          </tr>
          <tr>
            <Cell label="Número de série" value={data.asset.serialNumber} />
            <Cell label="Patrimônio" value={data.asset.patrimonyNumber} />
            <Cell label="Tag" value={data.asset.tag} />
          </tr>
          <AssetSpecRows specs={data.asset.specs} />
          {data.asset.observedIdentification ? (
            <tr>
              <td colSpan={3}>
                <span className="cell-label">Identificação observada</span>
                <span className="cell-value">
                  {data.asset.observedIdentification}
                </span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="section-title">Serviço executado</div>
      <table className="form-table">
        <tbody>
          <tr>
            <Cell label="Serviço solicitado" value={requestedService} />
            <Cell label="Resultado" value={data.execution.result} />
            <Cell
              label="Forma de entrega"
              value={data.delivery.deliveryMethod}
            />
          </tr>
          <tr>
            <Cell label="Local do serviço" value={serviceLocation} />
            <Cell
              label="Concluído em"
              value={formatDate(data.execution.finishedAt)}
            />
            <Cell
              label="Entregue em"
              value={formatDate(data.delivery.deliveredAt)}
            />
          </tr>
          <tr>
            <td colSpan={3}>
              <span className="cell-label">Recebido por</span>
              <span className="cell-value">{text(receivedBy)}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="notes-box exec-notes">
        {[
          data.execution.servicePerformed,
          data.execution.partsUsedSummary,
          data.execution.technicalNotes,
        ]
          .filter(Boolean)
          .join("\n")}
      </div>

      <div className="section-title">Itens cobrados / peças utilizadas</div>
      <table className="form-table parts-table">
        <thead>
          <tr>
            <th style={{ width: "46%" }}>Descrição</th>
            <th style={{ width: "10%" }}>Qtd.</th>
            <th style={{ width: "10%" }}>Un.</th>
            <th style={{ width: "17%" }}>Valor unit.</th>
            <th style={{ width: "17%" }}>Valor total</th>
          </tr>
        </thead>
        <tbody>
          {data.execution.items.map((item, index) => (
            <tr key={index}>
              <td>{item.description}</td>
              <td className="num">{item.quantity}</td>
              <td>{item.unit}</td>
              <td className="num">{money(item.unitPriceCents)}</td>
              <td className="num">{money(item.totalPriceCents)}</td>
            </tr>
          ))}
          {data.execution.items.length === 0 ? (
            <tr>
              <td colSpan={5}>Nenhum item financeiro registrado.</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <table className="form-table">
        <tbody>
          <tr>
            <Cell
              label="Serviços"
              value={money(data.execution.subtotalServicesCents)}
            />
            <Cell
              label="Peças"
              value={money(data.execution.subtotalPartsCents)}
            />
            <td className="total-strong">
              <span className="cell-label">Total do reparo</span>
              <span className="cell-value receipt-total">
                {money(data.execution.totalCents)}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      {data.asset.metrologyRegime === "LEGAL" ? (
        <>
          <div className="section-title">
            Marcas de Reparo e de Selagem — Inmetro / RBMLQ-I
          </div>
          <table className="form-table seal-section">
            <tbody>
              <tr>
                <Cell label="Marca de Reparo (nº)" value={sealNumber} />
                <Cell
                  label="Emitida em"
                  value={formatDate(data.delivery.inmetroRepairMarkIssuedAt)}
                />
                <td className="seal-cell" rowSpan={3}>
                  {copy === "lab" ? (
                    <>
                      <div className="seal-cap">
                        Cole aqui a Marca de Reparo
                      </div>
                      <div className="seal-target">
                        <span className="seal-cm seal-cm-tl" />
                        <span className="seal-cm seal-cm-tr" />
                        <span className="seal-cm seal-cm-bl" />
                        <span className="seal-cm seal-cm-br" />
                      </div>
                    </>
                  ) : (
                    // The number already prints in the first column of this same
                    // section — repeating it here (old "Marca de Reparo aplicada")
                    // gave the reader two labels for one fact. The client via keeps
                    // only the verification notice.
                    <span className="seal-note">
                      Marca de Reparo sujeita a verificação após o reparo pelo
                      IPEM / RBMLQ-I.
                    </span>
                  )}
                </td>
              </tr>
              <tr>
                <Cell
                  label="Marca de selagem retirada (nº)"
                  value={data.intake.removedSealingMarkNumber}
                />
                <Cell
                  label="Marca de selagem aposta (nº)"
                  value={data.intake.affixedSealingMarkNumber}
                />
              </tr>
              <tr>
                <td colSpan={2}>
                  <span className="cell-label">Observações de entrega</span>
                  <span className="cell-value">
                    {text(data.delivery.deliveryNotes)}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </>
      ) : (
        <>
          <div className="section-title">Conclusão</div>
          <table className="form-table">
            <tbody>
              <tr>
                <Cell
                  label="Observações de entrega"
                  value={data.delivery.deliveryNotes}
                />
                <Cell label="Resultado" value={data.execution.result} />
              </tr>
            </tbody>
          </table>
        </>
      )}

      {copy === "client" ? (
        <div className="ack-line">
          Declaro ter recebido o equipamento nas condições descritas neste
          comprovante, conferido o serviço executado e as marcas de selagem
          apostas, e atesto sua conformidade no ato da entrega.
        </div>
      ) : null}

      <div className="sign-area">
        <SignatureSlot
          caption="Assinatura do Técnico"
          role="Responsável Técnico — executor cadastrado no IPEM"
          idFields={["Documento"]}
          signature={data.delivery.technicianSignature}
        />
        <SignatureSlot
          caption="Assinatura do Cliente / Recebedor"
          role="Cliente / Recebedor"
          sub={data.customer.name}
          idFields={["Nome legível", "CPF / Documento"]}
          signature={data.delivery.clientSignature}
        />
      </div>
    </section>
  );
}

function LabCopy({ data }: { data: ServiceOrderDocumentData }) {
  const assetTag = data.asset.patrimonyNumber ?? data.asset.tag;
  const requested = new Set(data.requestedServices ?? ["Orçamento"]);
  return (
    <section className="page lab-copy">
      <div className="copy-tag">Via do laboratório</div>
      <Header data={data} />

      <div className="section-title">Dados principais</div>
      <table className="form-table">
        <tbody>
          <tr>
            <Cell label="Cliente" value={data.customer.name} />
            <Cell label="Documento" value={data.customer.taxId} />
            <Cell label="Entrada / Protocolo" value={data.serviceOrderNumber} />
          </tr>
          <tr>
            <Cell
              label="Forma de entrada"
              value={intakeTypeLabel(data.intakeType)}
            />
            <Cell label="Telefone" value={data.customer.phone} />
            <Cell label="E-mail" value={data.customer.email} />
          </tr>
          {data.isExternalService ? (
            <tr>
              <td colSpan={3}>
                <span className="cell-label">Endereço de atendimento</span>
                <span className="cell-value">
                  {text(data.customer.address)}
                </span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="section-title">Equipamento</div>
      <table className="form-table">
        <tbody>
          <tr>
            <Cell label="Equipamento" value={data.asset.name} />
            <Cell label="Tag / Patrimônio" value={assetTag} />
            <Cell label="Número de série" value={data.asset.serialNumber} />
          </tr>
          <tr>
            <Cell label="Fabricante" value={data.asset.manufacturer} />
            <Cell label="Modelo" value={data.asset.model} />
            <Cell label="Tipo" value={data.asset.type} />
          </tr>
          <AssetSpecRows specs={data.asset.specs} />
        </tbody>
      </table>

      <div className="section-title">Entrada</div>
      <table className="form-table">
        <tbody>
          <tr>
            <Cell label="Condição visual" value={data.intake.intakeCondition} />
            <Cell label="Acessórios" value={data.intake.accessories} />
          </tr>
          <tr>
            {data.asset.metrologyRegime === "LEGAL" ? (
              <Cell
                label="Marca de selagem retirada (nº)"
                value={data.intake.removedSealingMarkNumber}
              />
            ) : null}
            <Cell
              label="Documento / NF"
              value={
                data.intake.invoiceRemittanceNumber ??
                data.intake.invoiceRemittanceKey
              }
            />
          </tr>
          {data.asset.metrologyRegime === "LEGAL" ? (
            <tr>
              <Cell
                label="Marca de Reparo (nº)"
                value={data.intake.inmetroRepairMarkNumber}
                fallback=""
                tall
              />
              <Cell
                label="Marca de selagem aposta (nº)"
                value={data.intake.affixedSealingMarkNumber}
                fallback=""
                tall
              />
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="section-title">Histórico</div>
      <table className="form-table">
        <tbody>
          <tr>
            <Cell label="OS anterior" value={data.previousServiceOrderNumber} />
            <Cell
              label="Técnico anterior"
              value={data.previousTechnicianName}
            />
            <Cell
              label="Início do serviço"
              value={
                data.serviceStartedAt
                  ? formatDate(data.serviceStartedAt)
                  : "___/___/_____  ___:___"
              }
            />
          </tr>
        </tbody>
      </table>

      <div className="section">
        <div className="section-title">Serviço solicitado</div>
        <table className="form-table">
          <tbody>
            <tr>
              <td>
                <CheckboxLine
                  label="Calibração"
                  checked={requested.has("Calibração")}
                />
                <CheckboxLine
                  label="Manutenção corretiva"
                  checked={requested.has("Manutenção corretiva")}
                />
                <CheckboxLine
                  label="Manutenção preventiva"
                  checked={requested.has("Manutenção preventiva")}
                />
                <CheckboxLine
                  label="Ajuste"
                  checked={requested.has("Ajuste")}
                />
                <CheckboxLine
                  label="Orçamento"
                  checked={requested.has("Orçamento")}
                />
                <CheckboxLine
                  label="Garantia"
                  checked={requested.has("Garantia")}
                />
                <CheckboxLine
                  label="Outro: -"
                  checked={requested.has("Outro")}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="section-title">Problema informado</div>
      <div className="notes-box">{data.intake.claimedDefect}</div>

      <div className="section-title">Diagnóstico</div>
      <div className="writing-box" />

      <div className="section-title">Serviço executado</div>
      <div className="writing-box compact" />

      <div className="section-title">Observações</div>
      <div className="writing-box observations" />

      <div className="section-title">Peças utilizadas</div>
      <table className="form-table parts-table">
        <thead>
          <tr>
            <th style={{ width: "46%" }}>Descrição</th>
            <th style={{ width: "12%" }}>Qtd.</th>
            <th style={{ width: "21%" }}>Valor unit.</th>
            <th style={{ width: "21%" }}>Valor total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td />
            <td />
            <td />
            <td />
          </tr>
          <tr>
            <td />
            <td />
            <td />
            <td />
          </tr>
          <tr>
            <td />
            <td />
            <td />
            <td />
          </tr>
          <tr>
            <td />
            <td />
            <td />
            <td />
          </tr>
          <tr>
            <td />
            <td />
            <td />
            <td />
          </tr>
          <tr>
            <td />
            <td />
            <td />
            <td />
          </tr>
          <tr>
            <td />
            <td />
            <td />
            <td />
          </tr>
        </tbody>
      </table>

      <div className="section-title">Orçamento e aprovação</div>
      <table className="form-table">
        <tbody>
          <tr>
            <Cell label="Valor dos serviços" value={null} />
            <Cell label="Valor das peças" value={null} />
            <Cell label="Valor total" value={null} />
          </tr>
          <tr>
            <Cell label="Aprovação do cliente" value={null} />
            <Cell label="Aprovado por" value={null} />
            <Cell label="Data da aprovação" value={null} />
          </tr>
        </tbody>
      </table>

      <table className="form-table signature-table">
        <tbody>
          <tr>
            <Cell label="Assinatura do técnico" value={null} />
            <Cell label="Conferência / liberação" value={null} />
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function ClientCopy({ data }: { data: ServiceOrderDocumentData }) {
  const assetTag = data.asset.patrimonyNumber ?? data.asset.tag;
  const requestedService = (data.requestedServices ?? ["Orçamento"]).join(", ");
  return (
    <section className="page">
      <div className="copy-tag">Via do cliente</div>
      <Header data={data} />

      <div className="section-title">Comprovante de entrada</div>
      <table className="form-table">
        <tbody>
          <tr>
            <Cell label="Número da OS" value={data.serviceOrderNumber} />
            <Cell label="Entrada / Protocolo" value={data.serviceOrderNumber} />
            <Cell label="Previsão" value={null} />
          </tr>
          <tr>
            <Cell label="Cliente" value={data.customer.name} />
            <Cell label="Documento" value={data.customer.taxId} />
            <Cell label="Serviço solicitado" value={requestedService} />
          </tr>
        </tbody>
      </table>

      <div className="section-title">Equipamento recebido</div>
      <table className="form-table">
        <tbody>
          <tr>
            <Cell label="Equipamento" value={data.asset.name} />
            <Cell label="Tag / Patrimônio" value={assetTag} />
            <Cell label="Número de série" value={data.asset.serialNumber} />
          </tr>
          <tr>
            <Cell label="Fabricante" value={data.asset.manufacturer} />
            <Cell label="Modelo" value={data.asset.model} />
            <Cell label="Tipo" value={data.asset.type} />
          </tr>
        </tbody>
      </table>

      <div className="section-title">Problema informado / observações</div>
      <div className="notes-box">
        {[data.intake.claimedDefect, data.intake.clientVisibleNotes]
          .filter(Boolean)
          .join("\n")}
      </div>

      <div className="section-title">Instruções</div>
      <table className="form-table">
        <tbody>
          <tr>
            <td className="fine-print">
              <ol className="compact-list">
                <li>
                  Guarde este comprovante e informe a OS{" "}
                  {data.serviceOrderNumber} em qualquer contato com o
                  laboratório.
                </li>
                <li>
                  Este documento identifica o equipamento entregue e a abertura
                  do atendimento.
                </li>
                <li>
                  Reparos, substituição de peças, ajuste ou calibração poderão
                  depender de aprovação de orçamento.
                </li>
                <li>
                  Na devolução, confira equipamento, acessórios e eventuais
                  peças registradas na OS.
                </li>
                <li>
                  O prazo informado é uma previsão operacional e pode variar
                  conforme aprovação, disponibilidade de peças e complexidade
                  técnica.
                </li>
              </ol>
            </td>
          </tr>
        </tbody>
      </table>

      <table className="form-table signature-table">
        <tbody>
          <tr>
            <Cell
              label="Responsável pela entrada no laboratório"
              value={data.receiverName}
            />
            <Cell
              label="Cliente / entregador"
              value={data.signatureDataUrl ? "Assinado digitalmente" : null}
            />
          </tr>
        </tbody>
      </table>
    </section>
  );
}

export function ServiceOrderIntakeDocumentHtml({
  data,
}: {
  data: ServiceOrderDocumentData;
}) {
  return (
    <html lang="pt-BR" data-pdf-layout="full-page">
      <head>
        <meta charSet="UTF-8" />
        <title>Comprovante de recebimento - {data.serviceOrderNumber}</title>
        <style dangerouslySetInnerHTML={{ __html: pageStyles }} />
      </head>
      <body>
        <main>
          <LabCopy data={data} />
          <ClientCopy data={data} />
        </main>
      </body>
    </html>
  );
}

export function ServiceOrderTagHtml({ tag }: { tag: ServiceOrderTagData }) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="UTF-8" />
        <title>Etiqueta OS - {tag.serviceOrderNumber}</title>
        <style dangerouslySetInnerHTML={{ __html: pageStyles }} />
      </head>
      <body>
        <div className="tag">
          <div>
            <div className="tag-title">{tag.serviceOrderNumber}</div>
            <Field label="Cliente" value={tag.customerName} />
            <Field label="Instrumento" value={tag.assetName} />
            <Field
              label="Série/Patrimônio"
              value={tag.serialNumber ?? tag.patrimonyNumber}
            />
            <Field label="Entrada" value={formatDate(tag.openedAt)} />
          </div>
          <div>
            {tag.qrCodeDataUrl ? (
              <img className="qr" src={tag.qrCodeDataUrl} alt="QR Code" />
            ) : null}
          </div>
        </div>
      </body>
    </html>
  );
}

export function ServiceOrderQuoteHtml({
  data,
}: {
  data: ServiceOrderQuoteData;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="UTF-8" />
        <title>
          Orçamento - {data.quote.quoteNumber} v{data.quote.version}
        </title>
        <style dangerouslySetInnerHTML={{ __html: pageStyles }} />
      </head>
      <body>
        <main className="doc">
          <div className="header">
            <div>
              <h1 className="title">Orçamento de Ordem de Serviço</h1>
              <Field label="OS" value={data.serviceOrderNumber} />
              <Field
                label="Orçamento"
                value={`${data.quote.quoteNumber} v${data.quote.version}`}
              />
              <Field
                label="Validade"
                value={formatDate(data.quote.validUntil)}
              />
            </div>
            <div>
              {data.qrCodeDataUrl ? (
                <img className="qr" src={data.qrCodeDataUrl} alt="QR Code" />
              ) : null}
            </div>
          </div>
          <div className="grid">
            <div>
              <div className="section-title">Cliente</div>
              <Field label="Nome" value={data.customer.name} />
              <Field label="Documento" value={data.customer.taxId} />
            </div>
            <div>
              <div className="section-title">Instrumento</div>
              <Field label="Instrumento" value={data.asset.name} />
              <Field label="Série" value={data.asset.serialNumber} />
            </div>
          </div>
          <div className="section">
            <div className="section-title">Diagnóstico</div>
            <div>{data.quote.diagnosis || data.intake.claimedDefect}</div>
          </div>
          <table className="quote-table">
            <thead>
              <tr>
                <th>Descrição</th>
                <th className="num">Qtd.</th>
                <th>Un.</th>
                <th className="num">Unitário</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.quote.items.map((item, index) => (
                <tr key={index}>
                  <td>{item.description}</td>
                  <td className="num">{item.quantity}</td>
                  <td>{item.unit}</td>
                  <td className="num">{money(item.unitPriceCents)}</td>
                  <td className="num">{money(item.totalPriceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="section grid">
            <div>
              <Field
                label="Condições de pagamento"
                value={data.quote.paymentTerms}
              />
              <Field
                label="Prazo de entrega"
                value={data.quote.deliveryEstimate}
              />
              <Field label="Garantia" value={data.quote.warrantyTerms} />
            </div>
            <div>
              <Field
                label="Serviços"
                value={money(data.quote.subtotalServicesCents)}
              />
              <Field
                label="Peças"
                value={money(data.quote.subtotalPartsCents)}
              />
              <Field label="Frete" value={money(data.quote.freightCents)} />
              <Field
                label="Descontos"
                value={money(data.quote.discountCents)}
              />
              <div className="total">Total: {money(data.quote.totalCents)}</div>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}

export function ServiceOrderDeliveryReceiptHtml({
  data,
}: {
  data: ServiceOrderDeliveryReceiptData;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="UTF-8" />
        <title>Comprovante de entrega - {data.serviceOrderNumber}</title>
        <style dangerouslySetInnerHTML={{ __html: pageStyles }} />
      </head>
      <body>
        <main>
          <DeliveryReceiptCopy data={data} copy="client" />
          <DeliveryReceiptCopy data={data} copy="lab" />
        </main>
      </body>
    </html>
  );
}
