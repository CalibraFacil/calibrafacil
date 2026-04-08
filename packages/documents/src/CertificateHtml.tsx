import {
    type CertificateTemplateSnapshot,
    normalizeCertificateTemplateConfig,
} from "@calibra-facil/shared";

// Types for certificate generation (standalone, does not depend on @calibra-facil/db)

export type CustomerAddress = {
    cep?: string;
    number?: string;
    street?: string;
    neighbourhood?: string;
    city?: string;
    state?: string;
};

// Method input field definition (from method builder)
export type MethodInputField = {
    key: string;
    label: string;
    type: "text" | "number" | "select" | "table";
    unit?: string;
    required?: boolean;
    options?: string[];
    defaultValue?: string | number;
    columns?: Array<{
        key: string;
        label: string;
        type: "text" | "number";
        unit?: string;
    }>;
};

// Method formula definition (for labeling results)
export type MethodFormula = {
    outputKey: string;
    expression: string;
    label?: string;
    unit?: string;
};

export type MethodSnapshot = {
    methodId: number;
    methodName: string;
    methodVersion: number;
    dataFields?: MethodInputField[];
    formulas?: MethodFormula[];
};

export type CertifiedValue = {
    nominal: string;
    value: number;
    uncertainty: number;
    unit: string;
};

export type StandardSnapshot = {
    id: number;
    name: string;
    certificateNumber: string;
    calibrationDate: Date | string;
    uncertainty: number | null;
    uncertaintyUnit: string | null;
    coverageFactor: number;
    certifiedValues?: CertifiedValue[] | null;
};

export type EnvironmentalSnapshot = {
    temperature: number | null;
    humidity: number | null;
    pressure: number | null;
    recordedAt: string;
    recordedBy: string;
    limits: {
        temperature?: { min: number; max: number };
        humidity?: { min: number; max: number };
        pressure?: { min: number; max: number };
    } | null;
    withinLimits: boolean;
    outOfLimitsJustification: string | null;
};

export type JobData = {
    jobId: string;
    organizationId?: string | null;
    performedAt: Date | null;
    approvedAt: Date | null;
    environmentalSnapshot?: EnvironmentalSnapshot | null;
    lab: {
        name: string;
        cnpj?: string | null;
        accreditationNumber?: string | null;
        accreditationBody?: string | null;
        street?: string | null;
        number?: string | null;
        complement?: string | null;
        neighbourhood?: string | null;
        city?: string | null;
        state?: string | null;
        cep?: string | null;
        phone?: string | null;
        email?: string | null;
        website?: string | null;
        technicalManagerName?: string | null;
        technicalManagerTitle?: string | null;
    };
    customer: {
        name: string;
        taxId?: string | null;
        phone?: string | null;
        email?: string | null;
        address: CustomerAddress | null;
    };
    asset: {
        name: string;
        serialNumber: string;
        tag: string;
        model: string | null;
        manufacturer: string | null;
    };
    methodSnapshot: MethodSnapshot;
    standardsSnapshot: StandardSnapshot[] | null;
    data: Record<string, unknown> | null;
    results: Record<string, unknown> | null;
    approverName: string | null;
    certificateTemplateSnapshot?: CertificateTemplateSnapshot | null;
    // Visual signature image URL (presigned URL) - ISO 17025 Clause 7.8.2.1(q)
    approverSignatureUrl?: string | null;
    // Amendment fields - ISO 17025 Clause 7.8.4.1
    supersedesId?: number | null;
    supersededById?: number | null;
    amendmentNumber?: number | null;
    amendmentReason?: string | null;
    originalJobId?: string | null; // Human-readable ID of the superseded job
    originalApprovedAt?: Date | null;
};

const styles = `
  @page {
    size: A4;
    margin: 15mm;
  }
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 10pt;
    line-height: 1.4;
    color: #1a1a1a;
  }
  @media screen {
    body {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 15mm;
      background: white;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
    }
    .certificate {
      max-width: none;
      width: 100%;
    }
  }
  .certificate {
    max-width: 210mm;
    margin: 0 auto;
  }
  .certificate.density-compact {
    font-size: 9pt;
    line-height: 1.32;
  }
  .certificate.density-compact .section {
    margin-bottom: 12px;
  }
  .certificate.density-compact .header {
    padding-bottom: 10px;
    margin-bottom: 14px;
  }
  .certificate.density-compact th,
  .certificate.density-compact td {
    padding: 4px 6px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid var(--template-primary);
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .logo-section {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .header-style-minimal .header {
    display: block;
  }
  .header-style-minimal .logo-section {
    margin-bottom: 10px;
  }
  .header-style-minimal .cert-number {
    text-align: left;
  }
  .header-style-split .header {
    align-items: stretch;
    gap: 18px;
  }
  .header-style-split .cert-number {
    min-width: 220px;
    padding: 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--template-accent) 65%, white);
    border: 1px solid color-mix(in srgb, var(--template-primary) 20%, white);
  }
  .logo-placeholder {
    width: 60px;
    height: 60px;
    background: var(--template-primary);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: bold;
    font-size: 14pt;
  }
  .lab-info h1 {
    font-size: 16pt;
    color: var(--template-primary);
    margin-bottom: 2px;
  }
  .lab-info p {
    font-size: 8pt;
    color: #666;
  }
  .cert-number {
    text-align: right;
  }
  .cert-number h2 {
    font-size: 11pt;
    color: #333;
    margin-bottom: 4px;
  }
  .cert-number .number {
    font-size: 14pt;
    font-weight: bold;
    color: var(--template-primary);
  }
  .emphasis-formal .section-title,
  .emphasis-formal .lab-info h1,
  .emphasis-formal .cert-number .number {
    color: #223047;
  }
  .emphasis-formal .header {
    border-bottom-color: #223047;
  }
  .emphasis-neutral .section-title,
  .emphasis-neutral .lab-info h1,
  .emphasis-neutral .cert-number .number {
    color: #374151;
  }
  .emphasis-neutral .header {
    border-bottom-color: #d1d5db;
  }
  .section {
    margin-bottom: 16px;
  }
  .section-title {
    font-size: 11pt;
    font-weight: 600;
    color: var(--template-primary);
    border-bottom: 1px solid #ccc;
    padding-bottom: 4px;
    margin-bottom: 8px;
  }
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 24px;
  }
  .info-row {
    display: flex;
    gap: 8px;
  }
  .info-label {
    font-weight: 600;
    color: #555;
    min-width: 100px;
  }
  .info-value {
    color: #1a1a1a;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9pt;
  }
  th, td {
    border: 1px solid #ddd;
    padding: 6px 8px;
    text-align: left;
    white-space: pre-line;
  }
  th {
    background: var(--template-accent);
    font-weight: 600;
    color: #333;
  }
  tr:nth-child(even) {
    background: #fafafa;
  }
  .footer {
    margin-top: 24px;
    padding-top: 12px;
    border-top: 1px solid #ccc;
    display: flex;
    justify-content: space-between;
    font-size: 8pt;
    color: #666;
  }
  .signature-section {
    margin-top: 32px;
    display: flex;
    justify-content: flex-end;
  }
  .signature-box {
    text-align: center;
    width: 200px;
  }
  .signature-line {
    border-top: 1px solid #333;
    margin-bottom: 4px;
    padding-top: 4px;
  }
  .end-marker {
    text-align: center;
    font-size: 9pt;
    font-style: italic;
    color: #666;
    margin-top: 24px;
  }
  .data-table {
    margin-top: 8px;
  }
  .data-table-title {
    font-weight: 600;
    color: #333;
    margin-bottom: 4px;
    font-size: 10pt;
  }
  /* Amendment notice styles - ISO 17025 Clause 7.8.4.1 */
  .amendment-notice {
    border: 2px solid #f97316;
    background: #fff7ed;
    padding: 12px;
    margin-bottom: 16px;
    border-radius: 4px;
  }
  .amendment-notice h3 {
    color: #c2410c;
    font-size: 11pt;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .amendment-notice p {
    color: #9a3412;
    font-size: 9pt;
    margin-bottom: 4px;
  }
  .amendment-notice strong {
    color: #7c2d12;
  }
  /* Watermark container - covers entire page on every page */
  .superseded-watermark {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 9999;
  }
  .superseded-watermark-text {
    font-size: 72pt;
    font-weight: bold;
    color: rgba(239, 68, 68, 0.18);
    transform: rotate(-45deg);
    white-space: nowrap;
    letter-spacing: 8px;
  }
  @media print {
    .superseded-watermark {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
    }
  }
`;

function formatDate(date: Date | null | string): string {
    if (!date) return "-";
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleDateString("pt-BR");
}

function formatNumber(value: number, minDecimals = 4): string {
    let decimals = minDecimals;

    // Auto-expand precision for small numbers (ISO 17025 compliance)
    const abs = Math.abs(value);
    if (abs > 0) {
        if (abs < 0.0001) decimals = 5;
        if (abs < 0.00001) decimals = 6;
        if (abs < 0.000001) decimals = 7;
    }

    return value.toLocaleString("pt-BR", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}

function formatValue(value: unknown): string {
    if (value === null || value === undefined) return "-";
    if (Array.isArray(value))
        return value.map((v) => formatValue(v)).join(", ");
    if (typeof value === "number") return formatNumber(value);
    return String(value);
}

function formatAddress(address: CustomerAddress | null): string {
    if (!address) return "-";
    const parts = [
        address.street,
        address.number,
        address.neighbourhood,
        address.city,
        address.state,
        address.cep,
    ].filter(Boolean);
    return parts.join(", ") || "-";
}

function formatLabAddress(lab: JobData["lab"]): string | null {
    const parts = [
        lab.street,
        lab.number,
        lab.complement,
        lab.neighbourhood,
        lab.city,
        lab.state,
        lab.cep,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
}

function formatTaxId(taxId: string | null | undefined): string {
    if (!taxId) return "-";
    // Format CNPJ: XX.XXX.XXX/XXXX-XX
    if (taxId.length === 14) {
        return `${taxId.slice(0, 2)}.${taxId.slice(2, 5)}.${taxId.slice(5, 8)}/${taxId.slice(8, 12)}-${taxId.slice(12)}`;
    }
    // Format CPF: XXX.XXX.XXX-XX
    if (taxId.length === 11) {
        return `${taxId.slice(0, 3)}.${taxId.slice(3, 6)}.${taxId.slice(6, 9)}-${taxId.slice(9)}`;
    }
    return taxId;
}

// Render a data table based on method dataField definition
function DataTable({
    field,
    data,
}: {
    field: MethodInputField;
    data: unknown[];
}) {
    if (!field.columns || !Array.isArray(data) || data.length === 0) {
        return null;
    }

    return (
        <div className="data-table">
            <div className="data-table-title">{field.label}</div>
            <table>
                <thead>
                    <tr>
                        {field.columns.map((col) => (
                            <th key={col.key}>
                                {col.label}
                                {col.unit ? ` (${col.unit})` : ""}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {data.map((row, i) => (
                        <tr key={i}>
                            {field.columns!.map((col) => (
                                <td key={col.key}>
                                    {formatValue(
                                        (row as Record<string, unknown>)[col.key]
                                    )}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function CertificateHtml({ job }: { job: JobData }) {
    const templateSnapshot = job.certificateTemplateSnapshot ?? null;
    const templateConfig = normalizeCertificateTemplateConfig(
        templateSnapshot?.config
    );
    const dataFields = job.methodSnapshot?.dataFields || [];
    const formulas = job.methodSnapshot?.formulas || [];

    // Separate table fields from scalar fields
    const tableFields = dataFields.filter((f) => f.type === "table");
    const scalarFields = dataFields.filter((f) => f.type !== "table");

    // Get environment data from structured snapshot
    const envTemperature = job.environmentalSnapshot?.temperature ?? null;
    const envHumidity = job.environmentalSnapshot?.humidity ?? null;
    const envPressure = job.environmentalSnapshot?.pressure ?? null;

    // Build results with labels from formulas
    const resultEntries: Array<{ key: string; label: string; value: unknown; unit?: string }> = [];
    if (job.results) {
        for (const [key, value] of Object.entries(job.results)) {
            const formula = formulas.find((f) => f.outputKey === key);
            resultEntries.push({
                key,
                label: formula?.label || key,
                value,
                unit: formula?.unit,
            });
        }
    }

    const dynamicStyles = `
      :root {
        --template-primary: ${templateConfig.theme.primaryColor};
        --template-accent: ${templateConfig.theme.accentColor};
      }
      .logo-image {
        max-width: 72px;
        max-height: 72px;
        object-fit: contain;
      }
      .intro {
        margin-bottom: 16px;
        padding: 12px;
        background: color-mix(in srgb, var(--template-accent) 75%, white);
        border-left: 4px solid var(--template-primary);
        font-size: 9pt;
      }
    `;

    return (
        <html lang="pt-BR">
            <head>
                <meta charSet="UTF-8" />
                <title>Certificado de Calibração - {job.jobId}</title>
                <style
                    dangerouslySetInnerHTML={{
                        __html: `${dynamicStyles}\n${styles}`,
                    }}
                />
            </head>
            <body>
                <div
                    className={`certificate density-${templateConfig.layout.density} header-style-${templateConfig.layout.headerStyle} emphasis-${templateConfig.layout.emphasis}`}
                >
                    {/* Header */}
                    <div className="header">
                        <div className="logo-section">
                            {templateConfig.theme.logoUrl ? (
                                <img
                                    src={templateConfig.theme.logoUrl}
                                    alt={job.lab.name}
                                    className="logo-image"
                                />
                            ) : (
                                <div className="logo-placeholder">LAB</div>
                            )}
                            <div className="lab-info">
                                <h1>{job.lab.name}</h1>
                                {job.lab.cnpj && templateConfig.sections.showAccreditation && (
                                    <p>CNPJ: {formatTaxId(job.lab.cnpj)}</p>
                                )}
                                {job.lab.accreditationNumber &&
                                    templateConfig.sections.showAccreditation && (
                                    <p>
                                        {job.lab.accreditationNumber}
                                        {job.lab.accreditationBody &&
                                            ` - ${job.lab.accreditationBody}`}
                                    </p>
                                )}
                                {formatLabAddress(job.lab) &&
                                    templateConfig.sections.showLabAddress && (
                                    <p>{formatLabAddress(job.lab)}</p>
                                )}
                                {(job.lab.phone || job.lab.email) &&
                                    templateConfig.sections.showLabContact && (
                                    <p>
                                        {job.lab.phone}
                                        {job.lab.phone && job.lab.email && " | "}
                                        {job.lab.email}
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="cert-number">
                            <h2>{templateConfig.content.documentTitle}</h2>
                            <div className="number">{job.jobId}</div>
                        </div>
                    </div>

                    {/* Amendment Notice - ISO 17025 Clause 7.8.4.1 */}
                    {job.supersedesId && templateConfig.sections.showAmendmentNotice && (
                        <div className="amendment-notice">
                            <h3>CERTIFICADO RETIFICADO</h3>
                            <p>
                                Este certificado <strong>substitui e cancela</strong> o certificado nº{" "}
                                <strong>{job.originalJobId || `#${job.supersedesId}`}</strong>
                            </p>
                            <p>
                                <strong>Retificação nº {job.amendmentNumber || 1}</strong>
                            </p>
                            {job.amendmentReason && (
                                <p>
                                    <strong>Motivo da retificação:</strong> {job.amendmentReason}
                                </p>
                            )}
                            {job.originalApprovedAt && (
                                <p>
                                    Certificado original emitido em: {formatDate(job.originalApprovedAt)}
                                </p>
                            )}
                        </div>
                    )}

                    {templateConfig.content.introText && (
                        <div className="intro">{templateConfig.content.introText}</div>
                    )}

                    {/* Superseded Watermark - appears on all pages */}
                    {job.supersededById && (
                        <div className="superseded-watermark">
                            <span className="superseded-watermark-text">CANCELADO</span>
                        </div>
                    )}

                    {/* Customer Section */}
                    <div className="section">
                        <div className="section-title">Cliente</div>
                        <div className="info-grid">
                            <div className="info-row">
                                <span className="info-label">Nome:</span>
                                <span className="info-value">{job.customer.name}</span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">CNPJ/CPF:</span>
                                <span className="info-value">
                                    {formatTaxId(job.customer.taxId)}
                                </span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">Endereço:</span>
                                <span className="info-value">
                                    {formatAddress(job.customer.address)}
                                </span>
                            </div>
                            {job.customer.phone && templateConfig.sections.showCustomerContact && (
                                <div className="info-row">
                                    <span className="info-label">Telefone:</span>
                                    <span className="info-value">{job.customer.phone}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Asset Section */}
                    <div className="section">
                        <div className="section-title">Instrumento Calibrado</div>
                        <div className="info-grid">
                            <div className="info-row">
                                <span className="info-label">Descrição:</span>
                                <span className="info-value">{job.asset.name}</span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">Fabricante:</span>
                                <span className="info-value">
                                    {job.asset.manufacturer || "-"}
                                </span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">Modelo:</span>
                                <span className="info-value">{job.asset.model || "-"}</span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">Nº Série:</span>
                                <span className="info-value">{job.asset.serialNumber}</span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">Tag:</span>
                                <span className="info-value">{job.asset.tag}</span>
                            </div>
                        </div>
                    </div>

                    {/* Method */}
                    <div className="section">
                        <div className="section-title">Método de Calibração</div>
                        <div className="info-grid">
                            <div className="info-row">
                                <span className="info-label">Procedimento:</span>
                                <span className="info-value">
                                    {job.methodSnapshot.methodName} (v
                                    {job.methodSnapshot.methodVersion})
                                </span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">Data:</span>
                                <span className="info-value">
                                    {formatDate(job.performedAt)}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Environment */}
                    {templateConfig.sections.showEnvironmental &&
                        (envTemperature != null || envHumidity != null || envPressure != null) && (
                        <div className="section">
                            <div className="section-title">Condições Ambientais</div>
                            <div className="info-grid">
                                {envTemperature != null && (
                                    <div className="info-row">
                                        <span className="info-label">Temperatura:</span>
                                        <span className="info-value">
                                            {formatNumber(envTemperature, 1)} °C
                                        </span>
                                    </div>
                                )}
                                {envHumidity != null && (
                                    <div className="info-row">
                                        <span className="info-label">Umidade:</span>
                                        <span className="info-value">
                                            {formatNumber(envHumidity, 1)} %
                                        </span>
                                    </div>
                                )}
                                {envPressure != null && (
                                    <div className="info-row">
                                        <span className="info-label">Pressão:</span>
                                        <span className="info-value">
                                            {formatNumber(envPressure, 1)} hPa
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Standards Used */}
                    {templateConfig.sections.showStandards &&
                        job.standardsSnapshot &&
                        job.standardsSnapshot.length > 0 && (
                        <div className="section">
                            <div className="section-title">Padrões Utilizados</div>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Padrão</th>
                                        <th>Certificado</th>
                                        <th>Incerteza</th>
                                        <th>Validade</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {job.standardsSnapshot.map((std, i) => (
                                        <tr key={i}>
                                            <td>{std.name}</td>
                                            <td>{std.certificateNumber}</td>
                                            <td>
                                                {std.certifiedValues &&
                                                std.certifiedValues.length > 0
                                                    ? "Vários (ver tabela)"
                                                    : std.uncertainty !== null
                                                      ? `±${formatNumber(std.uncertainty)} ${std.uncertaintyUnit || ""}`
                                                      : "-"}
                                            </td>
                                            <td>{formatDate(std.calibrationDate)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {/* Certified Values for Weight Sets */}
                            {job.standardsSnapshot.some(
                                (std) =>
                                    std.certifiedValues &&
                                    std.certifiedValues.length > 0
                            ) && (
                                <div className="data-table">
                                    <div className="data-table-title">
                                        Valores Certificados dos Padrões
                                    </div>
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Padrão</th>
                                                <th>Valor Nominal</th>
                                                <th>Valor Certificado</th>
                                                <th>Incerteza</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {job.standardsSnapshot.flatMap(
                                                (std) =>
                                                    std.certifiedValues?.map(
                                                        (cv, i) => (
                                                            <tr
                                                                key={`${std.id}-${i}`}
                                                            >
                                                                <td>
                                                                    {i === 0
                                                                        ? std.name
                                                                        : ""}
                                                                </td>
                                                                <td>
                                                                    {cv.nominal}
                                                                </td>
                                                                <td>
                                                                    {formatNumber(
                                                                        cv.value
                                                                    )}{" "}
                                                                    {cv.unit}
                                                                </td>
                                                                <td>
                                                                    ±
                                                                    {formatNumber(
                                                                        cv.uncertainty
                                                                    )}{" "}
                                                                    {cv.unit}
                                                                </td>
                                                            </tr>
                                                        )
                                                    ) || []
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Calibration Data Tables */}
                    {tableFields.length > 0 && job.data && (
                        <div className="section">
                            <div className="section-title">Dados de Calibração</div>
                            {tableFields.map((field) => {
                                const tableData = job.data?.[field.key];
                                if (!Array.isArray(tableData)) return null;
                                return (
                                    <DataTable
                                        key={field.key}
                                        field={field}
                                        data={tableData}
                                    />
                                );
                            })}
                        </div>
                    )}

                    {/* Results */}
                    {templateConfig.sections.showResults && resultEntries.length > 0 && (
                        <div className="section">
                            <div className="section-title">Resultados</div>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Parâmetro</th>
                                        <th>Valor</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {resultEntries.map(({ key, label, value, unit }) => (
                                        <tr key={key}>
                                            <td>{label}</td>
                                            <td>
                                                {formatValue(value)}
                                                {unit ? ` ${unit}` : ""}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Signature - ISO 17025 Clause 7.8.2.1(q) */}
                    {templateConfig.sections.showSignature && (
                        <div className="signature-section">
                            <div className="signature-box">
                            {/* Visual signature image */}
                            {job.approverSignatureUrl && (
                                <img
                                    src={job.approverSignatureUrl}
                                    alt="Assinatura"
                                    style={{
                                        maxHeight: "60px",
                                        maxWidth: "180px",
                                        marginBottom: "4px",
                                        display: "block",
                                        marginLeft: "auto",
                                        marginRight: "auto",
                                    }}
                                />
                            )}
                            <div className="signature-line">
                                {job.lab.technicalManagerName ||
                                    job.approverName ||
                                    "-"}
                            </div>
                            <div>
                                {job.lab.technicalManagerTitle ||
                                    "Responsável Técnico"}
                            </div>
                            <div style={{ fontSize: "8pt", color: "#666" }}>
                                {formatDate(job.approvedAt)}
                            </div>
                        </div>
                    </div>
                    )}

                    {/* Footer */}
                    <div className="footer">
                        <div>Emitido em: {formatDate(new Date())}</div>
                        {templateConfig.content.footerNote && (
                            <div>{templateConfig.content.footerNote}</div>
                        )}
                    </div>

                    {/* End of Document Marker (ISO requirement) */}
                    <div className="end-marker">--- FIM DO CERTIFICADO ---</div>
                </div>
            </body>
        </html>
    );
}
