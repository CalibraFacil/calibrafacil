/** @jsxImportSource react */
// Types for label generation (standalone, does not depend on @calibra-facil/db)

export type LabelData = {
    jobId: string; // Certificate number (e.g., "CAL-2025-0001")
    labName: string;
    assetTag: string;
    calibrationDate: Date | string | null;
    qrCodeDataUrl: string; // Pre-generated QR code as data URL
};

// Styles for 50mm x 30mm thermal printer label
// High contrast B&W design for thermal printers
const labelStyles = `
  @page {
    size: 50mm 30mm;
    margin: 0;
  }
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  html, body {
    width: 50mm;
    height: 30mm;
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: white;
  }
  .label {
    width: 50mm;
    height: 30mm;
    padding: 1.5mm;
    font-family: Arial, Helvetica, sans-serif;
    display: flex;
    gap: 1.5mm;
    background: white;
    color: black;
  }
  .qr-section {
    width: 22mm;
    height: 27mm;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .qr-section img {
    width: 22mm;
    height: 22mm;
    image-rendering: pixelated;
  }
  .info-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
    min-width: 0;
  }
  .calibrado {
    font-size: 8pt;
    font-weight: bold;
    text-align: center;
    background: black;
    color: white;
    padding: 0.8mm 0.5mm;
    letter-spacing: 0.2mm;
    text-transform: uppercase;
  }
  .lab-name {
    font-size: 5.5pt;
    font-weight: bold;
    text-align: center;
    margin-top: 0.5mm;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .details {
    font-size: 6.5pt;
    line-height: 1.4;
    margin-top: 0.5mm;
  }
  .details .field {
    display: flex;
    gap: 1mm;
  }
  .details .field-label {
    font-weight: bold;
    flex-shrink: 0;
  }
  .details .field-value {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cert-number {
    font-size: 5pt;
    text-align: center;
    border-top: 0.3mm solid black;
    padding-top: 0.5mm;
    margin-top: auto;
    font-family: 'Courier New', monospace;
  }
`;

function formatShortDate(date: Date | string | null): string {
    if (!date) return "-";
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    });
}

export function LabelHtml({ label }: { label: LabelData }) {
    return (
        <html lang="pt-BR">
            <head>
                <meta charSet="UTF-8" />
                <title>Etiqueta - {label.jobId}</title>
                <style dangerouslySetInnerHTML={{ __html: labelStyles }} />
            </head>
            <body>
                <div className="label">
                    <div className="qr-section">
                        <img src={label.qrCodeDataUrl} alt="QR Code" />
                    </div>
                    <div className="info-section">
                        <div className="calibrado">Calibrado</div>
                        <div className="lab-name">{label.labName}</div>
                        <div className="details">
                            <div className="field">
                                <span className="field-label">TAG:</span>
                                <span className="field-value">{label.assetTag || "-"}</span>
                            </div>
                            <div className="field">
                                <span className="field-label">DATA:</span>
                                <span className="field-value">
                                    {formatShortDate(label.calibrationDate)}
                                </span>
                            </div>
                        </div>
                        <div className="cert-number">{label.jobId}</div>
                    </div>
                </div>
            </body>
        </html>
    );
}
