// Types for certificate generation (standalone, does not depend on @calibra-facil/db)

export type CustomerAddress = {
    cep?: string;
    number?: string;
    street?: string;
    neighbourhood?: string;
    city?: string;
    state?: string;
};

export type MethodSnapshot = {
    methodId: number;
    methodName: string;
    methodVersion: number;
};

export type StandardSnapshot = {
    id: number;
    name: string;
    certificateNumber: string;
    calibrationDate: Date | string;
    uncertainty: number | null;
    uncertaintyUnit: string | null;
    coverageFactor: number;
};

export type JobData = {
    jobId: string;
    performedAt: Date | null;
    approvedAt: Date | null;
    customer: {
        name: string;
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
    results: Record<string, unknown> | null;
    environment?: {
        temperature?: number;
        humidity?: number;
    };
    approverName: string | null;
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
  .certificate {
    max-width: 210mm;
    margin: 0 auto;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #0066cc;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .logo-section {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .logo-placeholder {
    width: 60px;
    height: 60px;
    background: #0066cc;
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
    color: #0066cc;
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
    color: #0066cc;
  }
  .section {
    margin-bottom: 16px;
  }
  .section-title {
    font-size: 11pt;
    font-weight: 600;
    color: #0066cc;
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
  }
  th {
    background: #f5f5f5;
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
`;

function formatDate(date: Date | null | string): string {
    if (!date) return "-";
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleDateString("pt-BR");
}

function formatValue(value: unknown): string {
    if (value === null || value === undefined) return "-";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "number") return value.toLocaleString("pt-BR");
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

export function CertificateHtml({ job }: { job: JobData }) {
    const resultEntries = job.results ? Object.entries(job.results) : [];

    return (
        <html lang="pt-BR">
            <head>
                <meta charSet="UTF-8" />
                <title>Certificado de Calibração - {job.jobId}</title>
                <style dangerouslySetInnerHTML={{ __html: styles }} />
            </head>
            <body>
                <div className="certificate">
                    {/* Header */}
                    <div className="header">
                        <div className="logo-section">
                            <div className="logo-placeholder">LAB</div>
                            <div className="lab-info">
                                <h1>Laboratório de Calibração</h1>
                                <p>ISO/IEC 17025:2017</p>
                            </div>
                        </div>
                        <div className="cert-number">
                            <h2>CERTIFICADO DE CALIBRAÇÃO</h2>
                            <div className="number">{job.jobId}</div>
                        </div>
                    </div>

                    {/* Customer Section */}
                    <div className="section">
                        <div className="section-title">Cliente</div>
                        <div className="info-grid">
                            <div className="info-row">
                                <span className="info-label">Nome:</span>
                                <span className="info-value">{job.customer.name}</span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">Endereço:</span>
                                <span className="info-value">
                                    {formatAddress(job.customer.address)}
                                </span>
                            </div>
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
                    {job.environment && (
                        <div className="section">
                            <div className="section-title">Condições Ambientais</div>
                            <div className="info-grid">
                                {job.environment.temperature !== undefined && (
                                    <div className="info-row">
                                        <span className="info-label">Temperatura:</span>
                                        <span className="info-value">
                                            {job.environment.temperature} °C
                                        </span>
                                    </div>
                                )}
                                {job.environment.humidity !== undefined && (
                                    <div className="info-row">
                                        <span className="info-label">Umidade:</span>
                                        <span className="info-value">
                                            {job.environment.humidity} %
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Standards Used */}
                    {job.standardsSnapshot && job.standardsSnapshot.length > 0 && (
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
                                                {std.uncertainty !== null
                                                    ? `±${std.uncertainty} ${std.uncertaintyUnit || ""}`
                                                    : "-"}
                                            </td>
                                            <td>{formatDate(std.calibrationDate)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Results */}
                    {resultEntries.length > 0 && (
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
                                    {resultEntries.map(([key, value]) => (
                                        <tr key={key}>
                                            <td>{key}</td>
                                            <td>{formatValue(value)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Signature */}
                    <div className="signature-section">
                        <div className="signature-box">
                            <div className="signature-line">{job.approverName || "-"}</div>
                            <div>Responsável Técnico</div>
                            <div style={{ fontSize: "8pt", color: "#666" }}>
                                {formatDate(job.approvedAt)}
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="footer">
                        <div>Emitido em: {formatDate(new Date())}</div>
                        <div>Página 1 de 1</div>
                    </div>

                    {/* End of Document Marker (ISO requirement) */}
                    <div className="end-marker">--- FIM DO CERTIFICADO ---</div>
                </div>
            </body>
        </html>
    );
}
