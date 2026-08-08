/** @jsxImportSource react */
import { formatAccreditationNumber } from "@calibra-facil/shared/accreditation";

import { AccreditationSealSvg } from "../AccreditationSeal.js";
import { CERTIFICATE_PAGE_STYLES } from "./certificate-styles.js";
import type {
  CalibrationCertificateData,
  CertificateEccentricity,
  CertificateRepeatability,
  CertificateResultTable,
  CertificateStandard,
} from "./types.js";

/**
 * The fixed, system-owned calibration certificate (#865).
 *
 * Replaces the lab-authored XLSX template. The layout is ours and identical
 * for every laboratory; the lab supplies only its identity — name, CNPJ,
 * address, logo, accreditation number and authorised signatory.
 *
 * Structure follows the convention shared by every accredited certificate
 * surveyed (UKAS LAB 5 ed. 5 Fig. 1/2, DAkkS, COFRAC, Brazilian RBC — see
 * docs/referencias/certificados-internacionais/README.md): the FIRST PAGE IS
 * AN IDENTITY PAGE, results begin on the continuation. Sections are numbered
 * as the RBC certificate does, in black over a rule.
 *
 * Content is driven by ISO/IEC 17025 §7.8.2.1 (a–p) and §7.8.4.1 (a–f); see
 * docs/referencias/iso-17025-7.8-conteudo.md for the clause-by-clause map.
 *
 * Renders identically in the operator's browser and in Gotenberg's Chromium:
 * no client-only APIs, no `useEffect`, every image a data URI.
 */

function Section(props: {
  index: number;
  title: string;
  keepTogether?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={props.keepTogether ? "section section--keep" : "section"}
    >
      <h2>
        {props.index}. {props.title}
      </h2>
      {props.children}
    </section>
  );
}

function FieldRow(props: {
  label: string;
  value?: string | null;
  mono?: boolean;
  wide?: boolean;
}) {
  if (!props.value) return null;
  return (
    <div className={props.wide ? "field field--wide" : "field"}>
      <span className="field__label">{props.label}</span>
      <span
        className={
          props.mono ? "field__value field__value--mono" : "field__value"
        }
      >
        {props.value}
      </span>
    </div>
  );
}

/**
 * Result table. The uncertainty column carries NO ± sign: NIT-DICLA-021
 * A.6.1 Nota 1 forbids it when values and uncertainties appear in a table —
 * the sign is only for the inline `y ± U` form. Units are factored into the
 * header, the way the real RBC certificate does it.
 */
function ResultTable({ table }: { table: CertificateResultTable }) {
  const unit = table.unit ? <span className="unit">{table.unit}</span> : null;
  const has = (pick: (row: (typeof table.rows)[number]) => unknown) =>
    table.rows.some((row) => Boolean(pick(row)));

  const showReference = has((row) => row.referenceValue);
  const showIndication = has((row) => row.indication);
  const showK = has((row) => row.coverageFactor);
  const showVeff = has((row) => row.effectiveDegreesOfFreedom);

  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Ponto</th>
            {showReference ? (
              <th className="num">
                VVC{unit}
              </th>
            ) : null}
            {showIndication ? (
              <th className="num">
                Indicação{unit}
              </th>
            ) : null}
            <th className="num">
              Erro{unit}
            </th>
            <th className="num">
              U{unit}
            </th>
            {showK ? <th className="num no-caps">k</th> : null}
            {showVeff ? (
              <th className="num no-caps">ν(eff)</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={`${row.point}-${index}`}>
              <td>{row.point}</td>
              {showReference ? (
                <td className="num">{row.referenceValue ?? "—"}</td>
              ) : null}
              {showIndication ? (
                <td className="num">{row.indication ?? "—"}</td>
              ) : null}
              <td className="num">{row.error ?? "—"}</td>
              <td className="num">{row.expandedUncertainty ?? "—"}</td>
              {showK ? (
                <td className="num">{row.coverageFactor ?? "—"}</td>
              ) : null}
              {showVeff ? (
                <td className="num">
                  {row.effectiveDegreesOfFreedom ?? "—"}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {table.note ? <p className="table-note">{table.note}</p> : null}
    </>
  );
}

/**
 * Repeatability. Mass only: it is the one quantity with a standalone
 * repeatability determination rather than a dispersion computed inline from
 * the same readings used for the mean.
 */
function RepeatabilityTable({ data }: { data: CertificateRepeatability }) {
  const columns = Math.max(...data.rows.map((row) => row.readings.length), 0);
  const unit = data.unit ? <span className="unit">{data.unit}</span> : null;
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Condição</th>
            {Array.from({ length: columns }, (_, index) => (
              <th className="num" key={index}>
                Leitura {index + 1}
                {unit}
              </th>
            ))}
            <th className="num">
              Repetibilidade{unit}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.phase}>
              <td>{row.phase}</td>
              {Array.from({ length: columns }, (_, index) => (
                <td className="num" key={index}>
                  {row.readings[index] ?? "—"}
                </td>
              ))}
              <td className="num">{row.value ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.note ? <p className="table-note">{data.note}</p> : null}
    </>
  );
}

/**
 * Eccentricity, with the platform diagram beside the table — the arrangement
 * the lab's own FOR 51 form used, and the reason
 * `renderEccentricityIndicatorSvgMarkup` was salvaged out of the deleted XLSX
 * renderer in the first place. The diagram marks which position the indicator
 * sat on, which is what makes the per-position figures interpretable.
 */
function EccentricityBlock({ data }: { data: CertificateEccentricity }) {
  const unit = data.unit ? <span className="unit">{data.unit}</span> : null;
  return (
    <>
      <div className="ecc">
        <div className="ecc__table">
          <table>
            <thead>
              <tr>
                <th>Posição</th>
                <th className="num">
                  Antes do ajuste{unit}
                </th>
                <th className="num">
                  Depois do ajuste{unit}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.position}>
                  <td>{row.position}</td>
                  <td className="num">{row.before ?? "—"}</td>
                  <td className="num">{row.after ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.indicatorSvg ? (
          /* No caption here: the generated SVG already draws its own
             "Posição do indicador" label, and adding one printed it twice. */
          <div
            className="ecc__diagram"
            dangerouslySetInnerHTML={{ __html: data.indicatorSvg }}
          />
        ) : null}
      </div>
      {data.maxDeviationText ? (
        <p className="table-note">
          Maior desvio de excentricidade: {data.maxDeviationText}
        </p>
      ) : null}
      {data.note ? <p className="table-note">{data.note}</p> : null}
    </>
  );
}

function StandardsTable({ standards }: { standards: CertificateStandard[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Padrão</th>
          <th>Certificado</th>
          {/* The calibrating body — the same fact the RBC certificate prints
              under "Rastreabilidade". Blank when unknown, never guessed. */}
          <th>Rastreabilidade</th>
          <th>Validade</th>
        </tr>
      </thead>
      <tbody>
        {standards.map((standard, index) => (
          <tr key={`${standard.certificateNumber}-${index}`}>
            <td>{standard.name}</td>
            <td>{standard.certificateNumber}</td>
            <td>{standard.issuer ?? "—"}</td>
            <td>{standard.validUntilText ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CalibrationCertificateHtml({
  data,
}: {
  data: CalibrationCertificateData;
}) {
  const accreditationText = formatAccreditationNumber(
    data.lab.accreditationNumber,
  );
  const showSeal = data.accredited && Boolean(accreditationText);

  // Numbered in reading order; computed so inserting a conditional section
  // never leaves a gap in the sequence.
  let sectionNumber = 0;
  const next = () => (sectionNumber += 1);

  return (
    <html lang="pt-BR" data-pdf-layout="certificate">
      <head>
        <meta charSet="utf-8" />
        <title>{`Certificado de Calibração ${data.certificateNumber}`}</title>
        <style
          dangerouslySetInnerHTML={{ __html: CERTIFICATE_PAGE_STYLES }}
        />
      </head>
      <body>
        {/* ── identity page ─────────────────────────────────────────────
            NIE-Cgcre-009 §11.5.2: the accreditation symbol goes on the
            FIRST page. Continuation pages carry the norm's substitute
            sentence instead, injected as the running header. */}
        <header className="masthead">
          <div className="masthead__lab">
            {data.lab.logoDataUrl ? (
              <img
                className="masthead__logo"
                src={data.lab.logoDataUrl}
                alt=""
              />
            ) : null}
            <p className="masthead__name">{data.lab.name}</p>
            <div className="masthead__meta">
              {data.lab.cnpj ? <div>CNPJ {data.lab.cnpj}</div> : null}
              {data.lab.addressText ? <div>{data.lab.addressText}</div> : null}
              <div>
                {[data.lab.phone, data.lab.email, data.lab.website]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          </div>
          {showSeal ? (
            <div className="masthead__seal">
              <AccreditationSealSvg
                accreditationNumber={data.lab.accreditationNumber}
              />
            </div>
          ) : null}
        </header>

        <div className="title-block">
          <h1 className="title">Certificado de Calibração</h1>
          <div className="title__number">{data.certificateNumber}</div>
          {data.supersedesText ? (
            <div className="title__pages">{data.supersedesText}</div>
          ) : null}
        </div>

        <Section index={next()} title="Cliente" keepTogether>
          <div className="fields">
            <FieldRow label="Razão social" value={data.customer.name} wide />
            <FieldRow label="CNPJ / CPF" value={data.customer.taxId} mono />
            <FieldRow
              label="Endereço"
              value={data.customer.addressText}
              wide
            />
          </div>
        </Section>

        <Section index={next()} title="Item calibrado" keepTogether>
          <div className="fields">
            <FieldRow label="Descrição" value={data.item.description} wide />
            <FieldRow label="Fabricante" value={data.item.manufacturer} />
            <FieldRow label="Modelo" value={data.item.model} />
            <FieldRow
              label="Nº de série"
              value={data.item.serialNumber}
              mono
            />
            <FieldRow label="Identificação" value={data.item.tag} mono />
            <FieldRow label="Capacidade" value={data.item.capacityText} />
            <FieldRow label="Divisão" value={data.item.divisionText} />
            <FieldRow
              label="Registro Inmetro"
              value={data.item.inmetroRegistration}
              mono
            />
            {/* §7.8.2.1(g) — omitted entirely when there was no receipt
                event (in loco, or handed straight to the bench). */}
            <FieldRow
              label="Estado na entrada"
              value={data.item.conditionOnReceipt}
              wide
            />
            <FieldRow label="Acessórios" value={data.item.accessories} wide />
          </div>
        </Section>

        <Section index={next()} title="Datas e local" keepTogether>
          <div className="fields">
            {/* §7.8.2.1(h) */}
            <FieldRow
              label="Recebimento"
              value={data.dates.receivedAtText}
              mono
            />
            {/* §7.8.2.1(i) */}
            <FieldRow
              label="Calibração"
              value={data.dates.performedAtText}
              mono
            />
            {/* §7.8.2.1(j) — printed even when equal to the calibration date */}
            <FieldRow label="Emissão" value={data.dates.issuedAtText} mono />
            {/* §7.8.2.1(c) */}
            <FieldRow label="Local" value={data.locationText} wide />
          </div>
        </Section>

        <Section index={next()} title="Método" keepTogether>
          <div className="fields">
            <FieldRow label="Método" value={data.method.name} wide />
            <FieldRow
              label="Procedimento"
              value={data.method.procedureCode}
              mono
            />
            <FieldRow
              label="Versão"
              value={
                data.method.version === null ||
                data.method.version === undefined
                  ? null
                  : String(data.method.version)
              }
              mono
            />
            <FieldRow
              label="Referências"
              value={data.method.referenceStandards?.join(" · ") ?? null}
              wide
            />
          </div>
        </Section>

        {data.environment ? (
          <Section index={next()} title="Condições ambientais" keepTogether>
            <div className="fields">
              <FieldRow
                label="Temperatura"
                value={data.environment.temperatureText}
                mono
              />
              <FieldRow
                label="Umidade relativa"
                value={data.environment.humidityText}
                mono
              />
              <FieldRow
                label="Pressão"
                value={data.environment.pressureText}
                mono
              />
            </div>
            {data.environment.outOfLimitsJustification ? (
              <div className="callout">
                <div className="callout__label">
                  Condições fora dos limites — justificativa
                </div>
                <p className="prose">
                  {data.environment.outOfLimitsJustification}
                </p>
              </div>
            ) : null}
          </Section>
        ) : null}

        <Section index={next()} title="Padrões e rastreabilidade">
          <StandardsTable standards={data.standards} />
          {/* §7.8.4.1(c). Absent when no standard names its calibrating
              body — we do not assert traceability we cannot evidence. */}
          {data.traceabilityStatementText ? (
            <p className="table-note">{data.traceabilityStatementText}</p>
          ) : null}
        </Section>

        {/* Closes the identity page. §7.8.2.1(d) wants the reader to be able
            to confirm the document is complete and genuine; the public verify
            route (#431) is how. */}
        {data.verificationUrl ? (
          <div className="verify">
            {data.qrCodeDataUrl ? (
              <img className="verify__qr" src={data.qrCodeDataUrl} alt="" />
            ) : null}
            <div className="verify__body">
              <div className="verify__label">Verificação de autenticidade</div>
              <p className="verify__hint">
                Confira a validade e o conteúdo deste certificado, e compare o
                arquivo recebido com o emitido pelo laboratório, em:
              </p>
              <div className="verify__url">{data.verificationUrl}</div>
            </div>
          </div>
        ) : null}

        {/* No forced break. In the real certificates surveyed, results
            landing on page 2 is what the CONTENT VOLUME does, not a rule —
            the identity block plus the standards table simply fills a page.
            Forcing it guaranteed a void on page 2 whenever the results are
            short, and would waste a page on a two-row certificate. Sections
            keep `break-inside: avoid`, so the split still falls cleanly. */}

        {data.resultTables.map((table) => (
          /* keepTogether so a short table is not split into an orphan row.
             It is a hint, not a guarantee: a table longer than a page still
             breaks, and `thead { display: table-header-group }` repeats the
             header on the continuation, which is the behaviour we want. */
          <Section
            key={table.title}
            index={next()}
            title={table.title}
            keepTogether
          >
            <ResultTable table={table} />
          </Section>
        ))}

        {data.repeatability ? (
          <Section index={next()} title="Repetibilidade" keepTogether>
            <RepeatabilityTable data={data.repeatability} />
          </Section>
        ) : null}

        {data.eccentricity ? (
          <Section index={next()} title="Excentricidade" keepTogether>
            <EccentricityBlock data={data.eccentricity} />
          </Section>
        ) : null}

        <Section index={next()} title="Incerteza de medição" keepTogether>
          {/* NIT-DICLA-021 A.6.1.1 / A.6.2 give the canonical sentence, and
              which one applies depends on whether the coverage factor came
              from the t-distribution — so it is composed upstream, not here. */}
          <p className="prose">{data.uncertaintyStatement}</p>
        </Section>

        {/* §7.8.2.1(n) — only when the technician recorded something. */}
        {data.methodDeviations ? (
          <Section
            index={next()}
            title="Desvios em relação ao método"
            keepTogether
          >
            <p className="prose">{data.methodDeviations}</p>
          </Section>
        ) : null}

        {/* §7.8.6.2 — needs all three of (a) scope, (b) specification and
            (c) decision rule. The method declares them or nothing prints:
            a conformity statement is the laboratory's judgement, not ours. */}
        {data.conformity ? (
          <Section
            index={next()}
            title="Declaração de conformidade"
            keepTogether
          >
            <div className="fields fields--single">
              <FieldRow label="Resultado" value={data.conformity.verdict} />
              <FieldRow
                label="Aplica-se a"
                value={data.conformity.appliesTo}
              />
              <FieldRow
                label="Especificação"
                value={data.conformity.specification}
              />
              <FieldRow
                label="Regra de decisão"
                value={data.conformity.decisionRule}
              />
            </div>
          </Section>
        ) : null}

        {data.observations ? (
          <Section index={next()} title="Observações" keepTogether>
            <p className="prose">{data.observations}</p>
          </Section>
        ) : null}

        <div className="signature">
          {data.signatory.placeAndDateText ? (
            <div className="signature__place">
              {data.signatory.placeAndDateText}
            </div>
          ) : null}
          {data.signatory.signatureImageDataUrl ? (
            <img
              className="signature__image"
              src={data.signatory.signatureImageDataUrl}
              alt=""
            />
          ) : null}
          <div className="signature__rule" />
          <div className="signature__name">{data.signatory.name}</div>
          {data.signatory.role ? (
            <div className="signature__role">{data.signatory.role}</div>
          ) : null}
        </div>

        <div className="declarations">
          <ul>
            {/* §7.8.2.1(l) */}
            <li>
              Os resultados referem-se exclusivamente ao item calibrado, no
              estado e nas condições em que foi recebido.
            </li>
            {/* NOTE to §7.8.2.1 — universal practice, and on the legacy form */}
            <li>
              Este certificado só pode ser reproduzido integralmente.
              Reproduções parciais dependem de autorização por escrito do
              laboratório.
            </li>
            <li>
              Este certificado não tem valor para fins de metrologia legal e
              não autoriza o uso do instrumento em relações de consumo.
            </li>
            {showSeal ? (
              /* NIE-Cgcre-009 §11.5.8.1 — optional MRA declaration, with the
                 norm's exact wording. */
              <li>A Cgcre é signatária do Acordo de Reconhecimento Mútuo da ILAC.</li>
            ) : (
              <li>
                Os resultados deste certificado não estão cobertos pela
                acreditação Cgcre/Inmetro.
              </li>
            )}
          </ul>
          {data.provenance ? (
            <div className="provenance">
              {[
                data.provenance.engineVersion
                  ? `motor ${data.provenance.engineVersion}`
                  : null,
                data.provenance.methodFingerprint
                  ? `método ${data.provenance.methodFingerprint}`
                  : null,
                data.provenance.resultFingerprint
                  ? `resultado ${data.provenance.resultFingerprint}`
                  : null,
              ]
                .filter(Boolean)
                .join("  ·  ")}
            </div>
          ) : null}
        </div>

        {/* §7.8.2.1(d) — clear identification of the end. */}
        <div className="end-mark">Fim do certificado</div>
      </body>
    </html>
  );
}
