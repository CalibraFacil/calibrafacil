# Como certificados de calibração reais se parecem

Levantamento editorial de certificados publicados por laboratórios acreditados de quatro países,
mais a única norma de _apresentação_ encontrada. Feito porque o desenho da PR #587 saiu "web-y" —
um dashboard impresso em papel — e a comparação com documentos reais é o que expõe isso.

Serve de base para o desenho do layout fixo (#865). **Não substitui** as normas de conteúdo:
[NIE-Cgcre-009](../nie-cgcre-009-simbolo-acreditacao.md),
[NIT-DICLA-021](../nit-dicla-021-incerteza.md),
[ISO/IEC 17025 §7.8](../iso-17025-7.8-conteudo.md).

## Fontes

Os certificados analisados pertencem a terceiros (laboratórios e seus clientes) e **não são
redistribuídos** neste repositório; ficam registradas apenas as observações de layout. A UKAS
LAB 5 está disponível em `ukas.com`.

| País | Documento                                                        | O que é                                                                          |
| ---- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 🇬🇧   | **UKAS LAB 5 ed. 5, jan/2025** — _Reporting calibration results_ | Norma de apresentação, com Fig. 1 (1ª página) e Fig. 2 (continuação). `ukas.com` |
| 🇩🇪   | DAkkS/DKD — Kalibrierlabor Westfalen, 2016                       | Certificado real, 2 páginas, bilíngue DE/EN                                      |
| 🇫🇷   | COFRAC — GFP Contrôle, acreditação 2-1614, 2018                  | Certificado real, 7 páginas, formulário FS42 V15.1                               |
| 🇧🇷   | RBC/Cgcre — laboratório de massa acreditado, 2023                | Certificado real, 3 páginas, bilíngue PT/EN                                      |

---

## O que os quatro fazem igual

**1. A primeira página é página de IDENTIDADE, não de resultados.**
O francês é o caso extremo: a página 1 tem o timbre, o título centrado, o cliente, a
identificação do instrumento, a data e a assinatura — e **mais nada**, com metade da folha em
branco. O alemão idem: capa com objeto/fabricante/série/cliente + a declaração de rastreabilidade,
resultados só na p.2. O brasileiro compacta mais, mas ainda abre por solicitante → instrumento →
ambiente → padrões → método, e a tabela de resultados só aparece na p.2. A Fig. 1 da UKAS
prescreve exatamente essa capa.

**2. Contagem de páginas explícita, e identidade repetida em toda página.**
`Ce certificat comprend 7 pages` (FR) · `Anzahl der Seiten des Kalibrierscheines: 2` (DE) ·
`Pág. 1/3` (BR) · `Page of pages` na Fig. 1 (UK). As páginas de continuação repetem número do
certificado + identificação: caixas no canto superior direito (DE, FR) ou o cabeçalho inteiro
(BR). É o §7.8.2.1(d) da ISO — "identificação de que as partes formam um relatório completo e
identificação clara do fim" — que hoje **não temos**.

**3. Monocromático. Cor só no logo do laboratório.**
Nenhum dos quatro usa cor semântica. Sem verde de aprovado, sem vermelho de erro negativo, sem
ícone, sem medalhão, sem _badge_. O brasileiro tem um filete vermelho no rodapé — é a marca da
empresa, não sinalização de estado.

**4. Título em caixa-alta, centrado, display.**
`CERTIFICAT D'ETALONNAGE` (FR, serifada) · `CERTIFICADO DE CALIBRAÇÃO Nº: …` (BR, com o número
na própria linha do título) · `CERTIFICATE OF CALIBRATION` (UK Fig. 1, serifada, dentro de caixa
com fio). O alemão é o único sem-serifa.

**5. Blocos rótulo:valor, com cabeçalho de seção sobre fio.**
Nada de cartões. O brasileiro usa faixa cinza-clara com o nome da seção; o francês usa negrito
sobre fio horizontal; o alemão usa colunas simples. Rótulo à esquerda em negrito, valor tabulado.

**6. Tabelas com grade ou fios, unidade no cabeçalho, sem zebra.**
O brasileiro: grade completa, cabeçalho em duas linhas com a unidade `(g)` embaixo do rótulo.
O alemão: grade completa, cabeçalho com cinza claro.

**7. Declarações permanentes em corpo pequeno ao pé, separadas por fio.**
Rastreabilidade ao SI, MRA, "não reproduzir exceto na íntegra". O francês:
_"La reproduction de ce certificat n'est autorisée que sous la forme de fac-similé photographique
intégral."_

**8. Assinatura por nome e cargo — sem imagem.**
`Le Responsable du Laboratoire / Jérôme Parvery` (FR) · `Leiter des Kalibrierlaboratoriums` +
`Bearbeiter`, dois nomes (DE). Nenhum dos dois usa assinatura digitalizada.

**9. Controle de documento no rodapé.**
`FS42 V15.1 du 29/05/2015` (FR). O certificado legado de um laboratório piloto fazia o mesmo (`FOR XX REVISÃO: NN`). É
identificação do formulário, não do certificado.

## Onde divergem

- **Bilíngue:** Alemanha e **Brasil** dobram todo rótulo (PT/EN, DE/EN), com o inglês em itálico
  ou corpo menor abaixo. França e Reino Unido, não. Para cliente exportador, vale considerar.
- **Seções numeradas:** o brasileiro numera de 1 a 6 (`1. Dados do Solicitante` … `6. Resultados
da Calibração`). Os outros três não numeram. Vale notar que a PR #587 **também** numerava — o
  problema dela nunca foi numerar, foi o _estilo_ da numeração (eyebrow azul de marca).
- **Densidade:** o francês é o mais arejado (capa quase vazia); o brasileiro o mais denso.

## O que o certificado brasileiro confirma na prática

Vale registrar porque valida três leituras normativas contra um documento real emitido:

- **A frase do NIE-009 §11.5.2** está lá, literal, no cabeçalho de **todas** as páginas:
  _"Laboratório de Calibração Acreditado pela Cgcre de acordo com a Norma NBR ISO/IEC 17025 Sob o
  n°XXXX"_, com a tradução inglesa abaixo.
- **Sem `±` na tabela de resultados** — coluna `Incerteza de medição (g)` com valor puro,
  exatamente como a NIT-DICLA-021 A.6.1 Nota 1 exige. Confirma que a regra é seguida na prática,
  e que um cabeçalho tipo `U ± (g)` destoaria.
- **`k` e `Veff` são colunas da tabela**, não nota de rodapé — `2,00` e `∞`. Atende o A.6.1.1/A.6.2
  por coluna em vez de por frase. É uma alternativa legítima à nota explicativa, e mais compacta.
- Seu selo ainda usa a redação **pré-rev.27** (`Calibração / NBR ISO/IEC / 17025`) — o certificado
  é de 2023 e a rev. 27 é de Jul/2024. Coerente com o prazo de transição até Jul/2027.
