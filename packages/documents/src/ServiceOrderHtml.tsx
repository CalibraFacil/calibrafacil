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
    capacity?: string | null;
    resolution?: string | null;
    accuracyClass?: string | null;
    observedIdentification?: string | null;
  };
  intake: {
    claimedDefect: string;
    intakeCondition: string;
    accessories?: string | null;
    invoiceRemittanceNumber?: string | null;
    invoiceRemittanceKey?: string | null;
    carrierName?: string | null;
    thirdPartyName?: string | null;
    oldSealNumber?: string | null;
    newSealNumber?: string | null;
    inmetroRepairSealNumber?: string | null;
    clientVisibleNotes?: string | null;
    internalNotes?: string | null;
    terms?: string | null;
  };
  requestedServices?: string[];
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
  .section-title { margin: 0.7mm 0 0.35mm; padding: 0.35mm 0.7mm; border: 1px solid #000; font-size: 7.1pt; font-weight: 700; text-transform: uppercase; background: #f2f2f2; }
  table.form-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 0.7mm; }
  .form-table td, .form-table th { border: 1px solid #000; padding: 0.55mm 0.85mm; vertical-align: top; }
  .form-table th { text-align: left; font-size: 6.8pt; font-weight: 700; text-transform: uppercase; background: #f2f2f2; }
  .cell-label { display: block; font-size: 6.1pt; font-weight: 700; text-transform: uppercase; margin-bottom: 0.15mm; }
  .cell-value { display: block; min-height: 1.8mm; white-space: pre-wrap; overflow-wrap: anywhere; }
  .notes-box { border: 1px solid #000; min-height: 6mm; padding: 0.65mm 0.85mm; white-space: pre-wrap; margin-bottom: 0.55mm; }
  .writing-box { border: 1px solid #000; height: 12mm; padding: 0; margin-bottom: 0.6mm; background: repeating-linear-gradient(to bottom, #fff 0, #fff 4mm, #000 4mm, #000 4.12mm); }
  .writing-box.compact { height: 7mm; }
  .parts-table td { height: 4.2mm; }
  .signature-table td { height: 5.5mm; }
  .fine-print { font-size: 7.5pt; }
  .compact-list { margin: 0; padding-left: 3.5mm; }
  .compact-list li { margin: 0.65mm 0; }
  .checkbox-line { display: inline-block; margin-right: 1.8mm; white-space: nowrap; }
  .checkbox { display: inline-flex; width: 2.35mm; height: 2.35mm; border: 1px solid #000; margin-right: 0.55mm; vertical-align: -0.3mm; align-items: center; justify-content: center; font-size: 5pt; font-weight: 700; line-height: 1; }
  .lab-copy { font-size: 7.45pt; }
  .lab-copy .header td { padding: 0.55mm 0.8mm; }
  .lab-copy .title { font-size: 10.2pt; }
  .lab-copy .os-number { font-size: 9.6pt; }
  .lab-copy .section-title { margin-top: 0.45mm; }
  .lab-copy table.form-table { margin-bottom: 0.45mm; }
  .lab-copy .form-table td, .lab-copy .form-table th { padding: 0.45mm 0.7mm; }
  .lab-copy .cell-label { font-size: 5.8pt; }
  .lab-copy .cell-value { min-height: 1.45mm; }
  .lab-copy .notes-box { min-height: 5mm; }
  .lab-copy .writing-box { height: 20mm; background: repeating-linear-gradient(to bottom, #fff 0, #fff 5mm, #000 5mm, #000 5.12mm); }
  .lab-copy .writing-box.compact { height: 30mm; }
  .lab-copy .parts-table td { height: 3.2mm; }
  .lab-copy .signature-table td { height: 4mm; }
  .qr { width: 82px; height: 82px; object-fit: contain; }
  .qr-cell { text-align: right; }
  .qr-url { font-size: 7pt; overflow-wrap: anywhere; margin-top: 1mm; }
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

function Field({ label, value }: { label: string; value?: unknown }) {
  return (
    <div className="field">
      <span className="label">{label}: </span>
      <span>{value ? String(value) : "-"}</span>
    </div>
  );
}

function Cell({ label, value }: { label: string; value?: unknown }) {
  return (
    <td>
      <span className="cell-label">{label}</span>
      <span className="cell-value">{text(value)}</span>
    </td>
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

function Header({ data }: { data: ServiceOrderDocumentData }) {
  return (
    <table className="header">
      <tbody>
        <tr>
          <td style={{ width: "64%" }}>
            <h1 className="title">ORDEM DE SERVIÇO</h1>
            <div className="header-info">
              <div className="header-info-line">{data.lab.name}</div>
              <div className="header-info-line">
                {[data.lab.phone, data.lab.email].filter(Boolean).join(" | ") || "-"}
              </div>
              <div className="header-info-line">CNPJ: {text(data.lab.cnpj)}</div>
              <div className="header-info-line">{text(data.lab.address)}</div>
            </div>
          </td>
          <td style={{ width: "36%" }}>
            <div className="meta-title">Número da OS</div>
            <div className="os-number">{data.serviceOrderNumber}</div>
            <div className="meta-line">Abertura: {formatDate(data.openedAt)}</div>
            <div className="meta-line">Entrada: {formatDate(data.openedAt)}</div>
            <div className="meta-line">Previsão: -</div>
            {data.qrCodeDataUrl ? (
              <div className="qr-cell">
                <img className="qr" src={data.qrCodeDataUrl} alt="QR Code" />
                <div className="qr-url">{data.publicUrl}</div>
              </div>
            ) : null}
          </td>
        </tr>
      </tbody>
    </table>
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
            <Cell label="Contato" value={data.customer.email} />
            <Cell label="Telefone" value={data.customer.phone} />
            <Cell label="E-mail" value={data.customer.email} />
          </tr>
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
          <tr>
            <Cell label="Capacidade / Faixa" value={data.asset.capacity} />
            <Cell label="Divisão / Resolução" value={data.asset.resolution} />
            <Cell label="Classe" value={data.asset.accuracyClass} />
          </tr>
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
            <Cell label="Lacre antigo" value={data.intake.oldSealNumber} />
            <Cell label="Documento / NF" value={data.intake.invoiceRemittanceNumber ?? data.intake.invoiceRemittanceKey} />
          </tr>
          <tr>
            <Cell label="Nº selo reparado Inmetro" value={data.intake.inmetroRepairSealNumber} />
            <Cell label="Lacre novo" value={data.intake.newSealNumber} />
          </tr>
        </tbody>
      </table>

      <div className="section">
        <div className="section-title">Serviço solicitado</div>
        <table className="form-table">
          <tbody>
            <tr>
              <td>
                <CheckboxLine label="Calibração" checked={requested.has("Calibração")} />
                <CheckboxLine label="Manutenção corretiva" checked={requested.has("Manutenção corretiva")} />
                <CheckboxLine label="Manutenção preventiva" checked={requested.has("Manutenção preventiva")} />
                <CheckboxLine label="Ajuste" checked={requested.has("Ajuste")} />
                <CheckboxLine label="Orçamento" checked={requested.has("Orçamento")} />
                <CheckboxLine label="Garantia" checked={requested.has("Garantia")} />
                <CheckboxLine label="Outro: -" checked={requested.has("Outro")} />
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
          <tr><td /><td /><td /><td /></tr>
          <tr><td /><td /><td /><td /></tr>
          <tr><td /><td /><td /><td /></tr>
          <tr><td /><td /><td /><td /></tr>
          <tr><td /><td /><td /><td /></tr>
          <tr><td /><td /><td /><td /></tr>
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
                <li>Guarde este comprovante e informe a OS {data.serviceOrderNumber} em qualquer contato com o laboratório.</li>
                <li>Este documento identifica o equipamento entregue e a abertura do atendimento.</li>
                <li>Reparos, substituição de peças, ajuste ou calibração poderão depender de aprovação de orçamento.</li>
                <li>Na devolução, confira equipamento, acessórios e eventuais peças registradas na OS.</li>
                <li>O prazo informado é uma previsão operacional e pode variar conforme aprovação, disponibilidade de peças e complexidade técnica.</li>
              </ol>
            </td>
          </tr>
        </tbody>
      </table>

      <table className="form-table signature-table">
        <tbody>
          <tr>
            <Cell label="Responsável pela entrada no laboratório" value={data.receiverName} />
            <Cell label="Cliente / entregador" value={data.signatureDataUrl ? "Assinado digitalmente" : null} />
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
    <html lang="pt-BR">
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
            <Field label="Série/Patrimônio" value={tag.serialNumber ?? tag.patrimonyNumber} />
            <Field label="Entrada" value={formatDate(tag.openedAt)} />
          </div>
          <div>{tag.qrCodeDataUrl ? <img className="qr" src={tag.qrCodeDataUrl} alt="QR Code" /> : null}</div>
        </div>
      </body>
    </html>
  );
}

export function ServiceOrderQuoteHtml({ data }: { data: ServiceOrderQuoteData }) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="UTF-8" />
        <title>Orçamento - {data.quote.quoteNumber} v{data.quote.version}</title>
        <style dangerouslySetInnerHTML={{ __html: pageStyles }} />
      </head>
      <body>
        <main className="doc">
          <div className="header">
            <div>
              <h1 className="title">Orçamento de Ordem de Serviço</h1>
              <Field label="OS" value={data.serviceOrderNumber} />
              <Field label="Orçamento" value={`${data.quote.quoteNumber} v${data.quote.version}`} />
              <Field label="Validade" value={formatDate(data.quote.validUntil)} />
            </div>
            <div>{data.qrCodeDataUrl ? <img className="qr" src={data.qrCodeDataUrl} alt="QR Code" /> : null}</div>
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
              <Field label="Condições de pagamento" value={data.quote.paymentTerms} />
              <Field label="Prazo de entrega" value={data.quote.deliveryEstimate} />
              <Field label="Garantia" value={data.quote.warrantyTerms} />
            </div>
            <div>
              <Field label="Serviços" value={money(data.quote.subtotalServicesCents)} />
              <Field label="Peças" value={money(data.quote.subtotalPartsCents)} />
              <Field label="Frete" value={money(data.quote.freightCents)} />
              <Field label="Descontos" value={money(data.quote.discountCents)} />
              <div className="total">Total: {money(data.quote.totalCents)}</div>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
