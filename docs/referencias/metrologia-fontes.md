# Fontes normativas de metrologia — índice

Bibliografia recuperada de 72 transcrições de sessões de pesquisa (163 URLs, 78 identificadores
normativos). Companheiro de [`certificados-requisitos-normativos.md`](./certificados-requisitos-normativos.md),
que é o documento operacional; este aqui é só o índice de onde as coisas vieram.

**PRIMÁRIA** = domínio do organismo emissor. **SECUNDÁRIA** = espelho, blog, fornecedor ou
consultoria. Secundária serve para entender; não serve para citar.

---

## 1. Peso de cada norma no produto

Ordenado por quantas vezes foi invocada no raciocínio ao longo de todas as sessões.

| Norma                                     | Menções | Papel no produto                                                                                                                                      | Situação                                              |
| ----------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **GUM / JCGM 100:2008**                   | 1.119   | Propagação de incerteza no `math-engine`; oráculo dos testes known-answer (u_c, sensibilidades, k, ν_eff conferidos a 10–12 casas)                    | confirmada                                            |
| **ISO/IEC 17025:2017**                    | 861     | Norma guarda-chuva: campos do certificado (§7.8.2/§7.8.6), NC do laboratório × do cliente (§7.10), retenção (§7.1.5.1), validade de resultados (§7.7) | confirmada — 2017 vigente, boato de "2025" refutado   |
| **ILAC-G24:2022 = OIML D 10:2022**        | 181     | Intervalos de recalibração — `packages/interval-analysis`; disciplina as-found                                                                        | confirmada                                            |
| **EURAMET cg-18**                         | 105     | Arredondamento de U em certificados de pesagem; método NAWI                                                                                           | ⚠️ edição a confirmar — texto nunca lido              |
| **ILAC-P14:09/2020**                      | 100     | Trava de CMC: U relatado nunca abaixo da CMC do escopo                                                                                                | confirmada                                            |
| **NIT-DICLA-083**                         | 87      | _(citada para assinatura digital)_                                                                                                                    | ⚠️ **citação corrigida → MP 2.200-2 + DOC-ICP-15.03** |
| **ILAC-G8:09/2019**                       | 75      | Regra de decisão — aceitação simples, `g=0`, exibida junto ao veredito                                                                                | confirmada                                            |
| **NCSLI RP-1:2010**                       | 70      | Ajuste de intervalo por confiabilidade; método de família, vocabulário EOPR, Clopper–Pearson                                                          | confirmada — `interval-analysis/src/reliability.ts`   |
| **EURAMET cg-04**                         | 59      | Orçamento GUM de força                                                                                                                                | ⚠️ edição a confirmar; implementação incompleta       |
| **OIML R 76-1 / Portaria Inmetro nº 236** | 51      | Classe de exatidão → EMA → veredito em pesagem                                                                                                        | ⚠️ edição a confirmar                                 |
| **DOQ-CGCRE-057**                         | 42      | Apresentação de resultados; campos da linha de escopo; formatos de CMC                                                                                | ⚠️ revisão a confirmar                                |
| **Portaria Inmetro nº 157/2022**          | 34      | Aprovação de modelo de balança — impressa nas vias da OS e no comprovante                                                                             | confirmada                                            |
| **NIT-DICLA-021**                         | 31      | Apresentação de resultado/incerteza; uso do símbolo de acreditação                                                                                    | ⚠️ nunca lida                                         |
| **NIT-DICLA-026**                         | 29      | Ciclo de 4 anos de ensaios de proficiência; hierarquia de provedores                                                                                  | ⚠️ "rev. 15" a confirmar                              |
| **EURAMET cg-15**                         | 28      | Template de tensão DC                                                                                                                                 | ⚠️ edição a confirmar                                 |
| **EURAMET cg-19 v4.1**                    | 27      | Volume gravimétrico (vidraria)                                                                                                                        | ⚠️ edição a confirmar                                 |
| **MP 2.200-2**                            | 23      | Validade jurídica do PDF assinado (ICP-Brasil)                                                                                                        | confirmada                                            |
| **OIML R 111**                            | 11      | Classe de pesos-padrão no catálogo de ativos                                                                                                          | ⚠️ edição a confirmar                                 |
| **ILAC-P8:11/2023**                       | 8       | Símbolo de acreditação restrito ao escopo                                                                                                             | confirmada                                            |
| **JCGM 106**                              | 7       | Regra de decisão, bandas de guarda (usada em conteúdo editorial)                                                                                      | ⚠️ edição a confirmar                                 |
| **Portaria Inmetro nº 156/2022**          | 5       | Catálogo de tecnologia de medidor de gás                                                                                                              | confirmada                                            |

Citadas de passagem, sem decisão associada: Portarias 124/2022, 155/2022, 158, 295/2018, 341, 369,
481, 493/2021 · RDC Anvisa 665/2022, 133, 4 · DOQ-CGCRE-087, 001, 066 · JCGM 101, 200 · ILAC-P15 ·
NIT-DICLA-031, 019, 012.

---

## 2. ILAC

| Documento                                                                                    | Link canônico                                                                                                                                                     | Consultada para                                                                                                            |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **ILAC-P14:09/2020** — Policy for Measurement Uncertainty in Calibration (substitui 01/2013) | [anúncio](https://ilac.org/latest_ilac_news/revised-ilac-p14-published/) · [série de políticas](https://ilac.org/publications-and-resources/ilac-policy-series/)  | Modelagem de CMC no escopo (valor fixo × fórmula × faixa); regra de que U relatado ≥ CMC; k=2; 2 algarismos significativos |
| **ILAC-G24:2022 / OIML D 10:2022** — Recalibration Intervals                                 | [OIML, texto integral](https://www.oiml.org/en/files/pdf_d/d010-e22.pdf) · [anúncio ILAC](https://ilac.org/latest_ilac_news/revised-ilac-g24-document-published/) | 5 métodos de revisão de intervalo; Método 1 (staircase §6.2) e carta de controle implementados                             |
| **ILAC-G8:09/2019** — Decision Rules and Statements of Conformity                            | [série de guidance](https://ilac.org/publications-and-resources/ilac-guidance-series/)                                                                            | Regra de decisão declarada no certificado (§7.8.6 da 17025)                                                                |
| **ILAC-P8:11/2023** — uso do símbolo                                                         | [série de políticas](https://ilac.org/publications-and-resources/ilac-policy-series/)                                                                             | Selo restrito a serviço dentro do escopo                                                                                   |

⚠️ `isobudgets.com` hospeda a **P14:01/2013**, edição superada. Documentos ILAC são de
distribuição gratuita — não é pirataria, mas está desatualizado. Usar sempre o canônico.

## 3. ISO / IEC

| Documento                                                     | Link                                                                                                          | Consultada para                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **ISO/IEC 17025:2017** (3ª ed., estágio 90.93)                | [catálogo](https://www.iso.org/standard/66912.html) · [OBP](https://www.iso.org/obp/ui/en/#!iso:std:66912:en) | §7.7 validade de resultados · §7.8.6 regra de decisão · §7.8.8 retificações · §7.10 trabalho não conforme |
| **ISO 13528:2022** — estatística para ensaios de proficiência | [catálogo](https://www.iso.org/standard/78879.html)                                                           | Escores z (§9.4), z′ (§9.5), ζ (§9.6), En (§9.7) e critérios de aceitação                                 |
| **ISO/IEC 17043:2023** — provedores de EP                     | [catálogo](https://www.iso.org/standard/80864.html)                                                           | Provedor de EP tem de ser acreditado nesta norma                                                          |
| ISO/IEC 17025:2005                                            | [catálogo](https://www.iso.org/standard/39883.html)                                                           | Só histórico — substituída                                                                                |

Revisão em curso: [ISO/CASCO](https://www.iso.org/committee/54998.html) WG44. Notícias
[ref2212](https://www.iso.org/news/ref2212.html) e [ref2250](https://www.iso.org/news/ref2250.html)
apareceram em busca mas **nunca foram abertas** — não citar conteúdo delas sem reconfirmar.

## 4. Inmetro / Cgcre e legislação brasileira

| Documento                                                                                       | Link                                                                                                                                                                                                     | Consultada para                                                                                     |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Índice de documentos para acreditação                                                           | [inmetro.gov.br](http://www.inmetro.gov.br/credenciamento/organismos/doc_organismos.asp?tOrganismo=CalibEnsaios) — PRIMÁRIA                                                                              | Porta de entrada; aponta NIT-DICLA-021 e NIE-Cgcre-009                                              |
| **DOQ-CGCRE-057** — apresentação e expressão de resultados                                      | [gov.br/cdtn](https://www.gov.br/cdtn/pt-br/centrais-de-conteudo/documentos-cgcre-abnt-nbr-iso-iec-17025/doq-cgcre-57) — SECUNDÁRIA (espelho institucional)                                              | Campos da linha de escopo; CMC como valor/fórmula/tabela                                            |
| **NIT-DICLA-026** — ensaios de proficiência                                                     | [gov.br/cdtn](https://www.gov.br/cdtn/pt-br/centrais-de-conteudo/documentos-cgcre-abnt-nbr-iso-iec-17025/nit-dicla-26) — SECUNDÁRIA                                                                      | Ciclo de 4 anos (§9.2.2); hierarquia de provedores (§10.1); resultado insatisfatório (§12)          |
| **DOQ-CGCRE-087** — orientações sobre a 17025:2017                                              | [inmetro.gov.br](http://www.inmetro.gov.br/credenciamento/eventos-cgcre/13-14-15Workshop/00-DOQ-CGCRE-087_rev_00_-_Orientacoes_gerais_sobre_os_requisitos_da_ABNT_NBR_ISO_IEC_17025_2017.pdf) — PRIMÁRIA | Material de workshop; não aprofundado                                                               |
| **NIE-Cgcre-009** — uso do símbolo de acreditação                                               | ❌ **sem link — nunca baixada**                                                                                                                                                                          | _A_ norma do selo em certificado. Lacuna crítica                                                    |
| **DOC-ICP-15.03** — assinaturas digitais ICP-Brasil (v9.1, IN ITI 34/2025 por fonte secundária) | [gov.br/iti](https://www.gov.br/iti/pt-br/central-de-conteudo/doc-icp-15-assinaturas-digitais-na-icp-brasil-pdf) — PRIMÁRIA                                                                              | Mapeamento AD-RB/RT/RC/RA ↔ PAdES B-B/B-T/B-LT/B-LTA                                                |
| Autoridades de Carimbo do Tempo credenciadas                                                    | [gov.br/iti](https://www.gov.br/iti/pt-br/assuntos/icp-brasil/autoridades-de-carimbo-do-tempo) — PRIMÁRIA                                                                                                | 9 ACTs; **nenhuma opção gratuita** credenciada                                                      |
| Provedores de EP acreditados                                                                    | [gov.br/inmetro](https://www.gov.br/inmetro/pt-br/assuntos/acreditacao-reconhecimento-bpl/organismos-acreditados/provedores-de-ensaios-de-proficiencia) — PRIMÁRIA                                       | Topo da hierarquia da NIT-DICLA-026                                                                 |
| ANVISA RDC 665/2022                                                                             | [gov.br/anvisa](https://www.gov.br/anvisa/pt-br/assuntos/noticias-anvisa/2022/rdc-665-de-2022) — PRIMÁRIA                                                                                                | BPF de dispositivos médicos exige registros de calibração disponíveis — justificativa do audit pack |
| Consulta CNPJ (Conecta)                                                                         | [gov.br/conecta](https://www.gov.br/conecta/catalogo/apis/consulta-cnpj) — PRIMÁRIA                                                                                                                      | Comparação de APIs de CNPJ                                                                          |

## 5. Guias de calibração (EURAMET, OIML)

| Guia                                                        | Link canônico                                                                                                                                | Método / template                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **EURAMET cg-18 v4.0** — Non-Automatic Weighing Instruments | [euramet.org](https://www.euramet.org/Media/docs/Publications/calguides/I-CAL-GUI-018_Calibration_Guide_No._18_web.pdf)                      | `weighing-instrument` — E = I − m_ref (§7.1); u(I) §7.1.1; u(m_ref) §7.1.2; validado contra o exemplo H1 |
| **EURAMET cg-15 v2.0** — Digital Multimeters                | [euramet.org](https://www.euramet.org/Media/docs/Publications/calguides/EURAMET_cg-15__v_2.0_Guidelines_Calibration_Digital_Multimeters.pdf) | `electrical-indication` — só tensão DC no v1; existe v3.0 só em espelhos                                 |
| **EURAMET cg-19 v4.1** — Gravimetric Volume                 | [euramet.org](https://www.euramet.org/Media/docs/Publications/calguides/I-CAL-GUI-019_Calibration_Guide_No._19_web.pdf)                      | `volume-glassware` — Eq. 1 (origem ISO 4787); fórmula de Tanaka para ρ_W                                 |
| **EURAMET cg-04 v3.0** — Force                              | [euramet.org](https://www.euramet.org/Media/docs/Publications/calguides/I-CAL-GUI-004_Calibration_Guideline_No._4_web.pdf)                   | `force-indication` — orçamento incompleto                                                                |

Espelhos Scribd de guias gratuitos são desnecessários — sempre o canônico.

## 6. NIST, UKAS, EA e outros

| Fonte                                                                            | Link                                                                                                                                                                                                                                                                     | Papel                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **NIST/SEMATECH e-Handbook** §6.3.2                                              | [itl.nist.gov](https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc32.htm)                                                                                                                                                                                          | Cartas I-MR, X-bar/R, CUSUM, EWMA; regras WECO para SPC                          |
| **NIST SOP-1** — Certificate Evaluation (App. B&C, 2019)                         | [nist.gov](https://www.nist.gov/document/sop-1-calibration-certificate-eval-app-b-c-20190506pdf)                                                                                                                                                                         | Checklist de avaliador; base da trava de "próxima calibração"                    |
| **UKAS LAB 14 ed. 8** (dez/2025)                                                 | [ukas.com](https://www.ukas.com/wp-content/uploads/schedule_uploads/759162/LAB-14-Guidance-on-the-calibration-of-weighing-machines.pdf)                                                                                                                                  | Corroboração de cobertura (§5.2) e múltiplos pesos (§4.2.2); §1.2 remete à cg-18 |
| **EA FAQ 50.1** e **45.2** — retificações (§7.8.8)                               | [50.1](https://european-accreditation.org/sp_accordion_faqs/50-1-question-on-amendments-to-reports-iso-iec-17025-clause-7-8-8/) · [45.2](https://european-accreditation.org/sp_accordion_faqs/45-2-question-on-amendments-to-test-reports-iso-iec-17025-clause-7-8-8-1/) | §7.8.8.1 e §7.8.8.3 aplicam-se em conjunto                                       |
| **NCSLI RP-1:2010**                                                              | [ncsli.org](https://ncsli.org/store/viewproduct.aspx?id=16959567)                                                                                                                                                                                                        | Método M5 / Clopper–Pearson                                                      |
| **JCGM GUM-6:2020**                                                              | [bipm.org](https://www.bipm.org/documents/20126/2071204/JCGM_GUM_6_2020.pdf)                                                                                                                                                                                             | Suplemento oficial do GUM — **nunca lido**, vale abrir                           |
| ANAB, PJLA, IPAC, Fluke, Morehouse, ISOBudgets, ABD Metrologia, Force Technology | —                                                                                                                                                                                                                                                                        | SECUNDÁRIAS — apoio didático, não citáveis                                       |

---

## 7. ❌ Não utilizar

Cópias integrais não autorizadas de norma paga. Não refazer o fetch, não citar:

- `ladakh.iisdindia.in/img/ISO_IEC_17025_2017(E)...pdf`
- `dastmardi.ir/wp-content/uploads/2017/09/ISO_IEC_17025_2017E.pdf`
- `exactusmetrologia.com.br/sites/default/files/3-nbr_iso_iec_17025-2017_versao_exclusiva_treinamento.pdf`

Canônicos: [ISO Store](https://www.iso.org/standard/66912.html) · catálogo ABNT para a NBR.

---

## 8. Pesquisa de mercado (não normativo)

Levantada nas mesmas sessões, mantida aqui só para não se perder — **não misturar com normas**:
Fluke Calibration Software · Beamex LOGiCAL · GAGEtrak (preço via G2) · IndySoft (via Capterra) ·
APE Calibration Control · MasterControl/Qualer · Metquay · ComplianceQuest · CalibrationOS.
Relevante para posicionamento e preço, não para conformidade.
