/** @jsxImportSource react */

/**
 * Out-of-tolerance customer notification (ABNT NBR ISO/IEC 17025:2017 §7.10 —
 * Trabalho não conforme). Formal pt-BR compliance letter sent to the customer
 * when a calibration finds the as-found condition outside the acceptance
 * tolerance, so the customer can evaluate the impact on measurements performed
 * since the last valid calibration. The "standard_recall" variant instead
 * notifies that a lab reference standard used in the customer's calibration
 * was later found out of tolerance, so the issued certificate may be affected.
 * Rendered to PDF via Gotenberg.
 *
 * It is DELIBERATELY NOT a calibration certificate: it references the
 * certificate and NC record, and carries a §7.10.1 disclaimer instead.
 */

export type OotNotificationDocumentData = {
  ncNumber: string;
  issuedAt: Date;
  /**
   * Notification variant. "as_found": the customer's instrument was found
   * out of tolerance during its calibration (Phase 0 behavior; default when
   * absent). "standard_recall": the lab's reference standard used in the
   * customer's calibration was later found out of tolerance, so the issued
   * certificate may be affected.
   */
  kind?: "as_found" | "standard_recall";
  /** Reference standard details (standard_recall variant). */
  standard?: {
    name: string;
    serialNumber?: string | null;
    certificateNumber?: string | null;
    calibrationDate?: Date | null;
  } | null;
  lab: {
    name: string;
    taxId?: string | null;
    address?: string | null;
    email?: string | null;
    phone?: string | null;
    logoUrl?: string | null;
  };
  customer: { name: string; email?: string | null };
  instrument: {
    description: string;
    tag?: string | null;
    serialNumber?: string | null;
  };
  certificateNumber?: string | null;
  /** As-found calibration (the one that found the OOT). */
  calibrationDate?: Date | null;
  /** Last good calibration — start of the potentially affected period. */
  previousCalibrationDate?: Date | null;
  asFound: {
    pointsTotal: number;
    pointsWithin: number;
    /** Most negative conformity margin, in the certificate's unit terms. */
    worstMargin?: number | null;
  };
  /** Free-text affected-scope entered by the lab. */
  affectedScope?: string | null;
  /** The NC description / deviation context. */
  description: string;
};

const pageStyles = `
  @page { size: A4; margin: 6mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; line-height: 1.35; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .letter { padding: 4mm 8mm; }
  .header { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
  .header td { border: 1px solid #000; padding: 1.5mm 2mm; vertical-align: middle; }
  .header-brand { display: flex; align-items: center; gap: 3mm; }
  .lab-logo { max-height: 14mm; max-width: 44mm; object-fit: contain; flex: 0 0 auto; }
  .lab-name { font-size: 11pt; font-weight: 700; line-height: 1.1; }
  .header-info { margin-top: 0.8mm; font-size: 7.6pt; line-height: 1.25; }
  .header-info-line { margin: 0.1mm 0; }
  .doc-meta { text-align: right; white-space: nowrap; }
  .meta-title { font-size: 6.8pt; font-weight: 700; text-transform: uppercase; margin-bottom: 0.4mm; }
  .nc-number { font-size: 11pt; font-weight: 700; font-family: "Courier New", monospace; font-variant-numeric: tabular-nums; margin-bottom: 0.6mm; }
  .meta-line { margin: 0; font-size: 7.6pt; }
  .doc-title { margin: 5mm 0 1mm; font-size: 13.5pt; font-weight: 700; text-align: center; }
  .doc-subtitle { margin: 0 0 5mm; font-size: 8pt; text-align: center; color: #333; }
  .addressee { margin: 0 0 4mm; }
  .addressee-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; margin-bottom: 0.5mm; }
  .addressee-name { font-size: 10.5pt; font-weight: 700; }
  .body-paragraph { margin: 0 0 3.5mm; text-align: justify; }
  .section-title { margin: 4mm 0 1.5mm; padding: 1mm 1.6mm; border: 1px solid #000; font-size: 8.2pt; font-weight: 700; text-transform: uppercase; background: #f2f2f2; }
  table.context-table { width: 100%; border-collapse: collapse; margin-bottom: 1mm; }
  .context-table th, .context-table td { border: 1px solid #000; padding: 1.2mm 1.8mm; vertical-align: top; text-align: left; font-size: 8.8pt; }
  .context-table th { width: 38%; font-weight: 700; background: #f7f7f7; }
  .mono-id { font-family: "Courier New", monospace; font-variant-numeric: tabular-nums; }
  .free-text { border: 1px solid #000; min-height: 10mm; padding: 1.6mm 2mm; white-space: pre-wrap; overflow-wrap: anywhere; }
  .actions-list { margin: 0; padding-left: 5mm; }
  .actions-list li { margin: 1.2mm 0; text-align: justify; }
  .disclaimer { margin-top: 6mm; padding: 2.2mm 2.8mm; border: 1px solid #000; background: #f7f7f7; font-size: 7.8pt; line-height: 1.35; text-align: justify; break-inside: avoid; }
`;

function formatDate(value: Date | null | undefined) {
  if (!value) return "—";
  return value.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function text(value: unknown, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function Header({ data }: { data: OotNotificationDocumentData }) {
  return (
    <table className="header">
      <tbody>
        <tr>
          <td style={{ width: "66%" }}>
            <div className="header-brand">
              {data.lab.logoUrl ? (
                <img
                  className="lab-logo"
                  src={data.lab.logoUrl}
                  alt={data.lab.name}
                />
              ) : null}
              <div>
                <div className="lab-name">{data.lab.name}</div>
                <div className="header-info">
                  <div className="header-info-line">
                    CNPJ: {text(data.lab.taxId)}
                  </div>
                  <div className="header-info-line">
                    {text(data.lab.address)}
                  </div>
                  <div className="header-info-line">
                    {[data.lab.phone, data.lab.email]
                      .filter(Boolean)
                      .join(" | ") || "—"}
                  </div>
                </div>
              </div>
            </div>
          </td>
          <td className="doc-meta" style={{ width: "34%" }}>
            <div className="meta-title">Não conformidade</div>
            <div className="nc-number">{data.ncNumber}</div>
            <div className="meta-line">
              Emissão: {formatDate(data.issuedAt)}
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function OotNotificationHtml({
  data,
}: {
  data: OotNotificationDocumentData;
}) {
  const isStandardRecall = data.kind === "standard_recall";
  const worstMargin =
    data.asFound.worstMargin === null || data.asFound.worstMargin === undefined
      ? null
      : data.asFound.worstMargin.toLocaleString("pt-BR");
  return (
    <html lang="pt-BR" data-pdf-layout="full-page">
      <head>
        <meta charSet="UTF-8" />
        <title>
          Notificação de Resultado Fora de Tolerância - {data.ncNumber}
        </title>
        <style dangerouslySetInnerHTML={{ __html: pageStyles }} />
      </head>
      <body>
        <main className="letter">
          <Header data={data} />

          <h1 className="doc-title">
            Notificação de Resultado Fora de Tolerância
          </h1>
          <p className="doc-subtitle">
            ABNT NBR ISO/IEC 17025:2017 — §7.10 Trabalho não conforme
            {isStandardRecall ? " · Recall de padrão de referência" : ""} · Não
            conformidade {data.ncNumber} · Emitida em{" "}
            {formatDate(data.issuedAt)}
          </p>

          <div className="addressee">
            <div className="addressee-label">Ao cliente</div>
            <div className="addressee-name">{data.customer.name}</div>
          </div>

          {isStandardRecall ? (
            <p className="body-paragraph">
              Prezado(a) cliente, durante a verificação/recalibração periódica
              de nossos padrões, o padrão de referência utilizado na calibração
              do instrumento abaixo identificado foi encontrado fora da
              tolerância aplicável. Os resultados reportados no certificado de
              calibração emitido podem, portanto, ter sido afetados. Em
              atendimento ao requisito §7.10 da ABNT NBR ISO/IEC 17025:2017,
              este laboratório notifica formalmente o cliente, de modo que possa
              ser avaliado o impacto sobre as medições realizadas com base no
              referido certificado.
            </p>
          ) : (
            <p className="body-paragraph">
              Prezado(a) cliente, durante a calibração do instrumento abaixo
              identificado, a condição como encontrada (&quot;as found&quot;)
              foi constatada fora da tolerância de aceitação aplicável. Em
              atendimento ao requisito §7.10 da ABNT NBR ISO/IEC 17025:2017,
              este laboratório notifica formalmente o cliente, de modo que possa
              ser avaliado o impacto potencial sobre as medições realizadas com
              este instrumento desde a sua última calibração válida.
            </p>
          )}

          <div className="section-title">Identificação e contexto</div>
          <table className="context-table">
            <tbody>
              <tr>
                <th>Instrumento</th>
                <td>{data.instrument.description}</td>
              </tr>
              <tr>
                <th>Tag</th>
                <td className="mono-id">{text(data.instrument.tag)}</td>
              </tr>
              <tr>
                <th>Número de série</th>
                <td className="mono-id">
                  {text(data.instrument.serialNumber)}
                </td>
              </tr>
              <tr>
                <th>Certificado</th>
                <td className="mono-id">{text(data.certificateNumber)}</td>
              </tr>
              <tr>
                <th>Data da calibração</th>
                <td>{formatDate(data.calibrationDate)}</td>
              </tr>
              <tr>
                <th>
                  Calibração anterior (início do período potencialmente afetado)
                </th>
                <td>{formatDate(data.previousCalibrationDate)}</td>
              </tr>
              {isStandardRecall ? (
                <>
                  <tr>
                    <th>Padrão de referência</th>
                    <td>
                      {text(data.standard?.name)}
                      {data.standard?.serialNumber ? (
                        <>
                          {" "}
                          — nº de série{" "}
                          <span className="mono-id">
                            {data.standard.serialNumber}
                          </span>
                        </>
                      ) : null}
                    </td>
                  </tr>
                  <tr>
                    <th>Certificado do padrão</th>
                    <td className="mono-id">
                      {text(data.standard?.certificateNumber)}
                    </td>
                  </tr>
                  <tr>
                    <th>Calibração do padrão</th>
                    <td>{formatDate(data.standard?.calibrationDate)}</td>
                  </tr>
                </>
              ) : (
                <>
                  <tr>
                    <th>Pontos avaliados</th>
                    <td>
                      {data.asFound.pointsWithin}/{data.asFound.pointsTotal}{" "}
                      dentro da tolerância
                    </td>
                  </tr>
                  {worstMargin !== null ? (
                    <tr>
                      <th>Pior margem de conformidade</th>
                      <td className="mono-id">{worstMargin}</td>
                    </tr>
                  ) : null}
                </>
              )}
            </tbody>
          </table>

          <div className="section-title">Descrição da não conformidade</div>
          <div className="free-text">{data.description}</div>

          {data.affectedScope ? (
            <>
              <div className="section-title">Escopo potencialmente afetado</div>
              <div className="free-text">{data.affectedScope}</div>
            </>
          ) : null}

          <div className="section-title">Ações recomendadas</div>
          <ol className="actions-list">
            {isStandardRecall ? (
              <li>
                Avaliar o impacto do desvio nas medições realizadas com base no
                certificado de calibração desde a data da calibração.
              </li>
            ) : (
              <li>
                Avaliar o impacto do desvio nas medições realizadas com o
                instrumento desde a última calibração válida.
              </li>
            )}
            <li>
              Identificar os itens, produtos ou processos medidos com o
              instrumento no período potencialmente afetado.
            </li>
            <li>
              Quando pertinente, reavaliar aprovações, liberações e decisões de
              conformidade baseadas nessas medições.
            </li>
            <li>
              Contatar o laboratório para suporte técnico na avaliação de
              impacto e na definição das ações decorrentes.
            </li>
          </ol>

          <div className="disclaimer">
            <strong>
              Esta notificação não substitui o certificado de calibração.
            </strong>{" "}
            Ela comunica a constatação de resultado fora de tolerância, em
            atendimento à ABNT NBR ISO/IEC 17025:2017 §7.10. A avaliação da
            significância do desvio para os resultados de medições anteriores é
            de responsabilidade do cliente, contando com o suporte técnico deste
            laboratório (§7.10.1).
          </div>
        </main>
      </body>
    </html>
  );
}
