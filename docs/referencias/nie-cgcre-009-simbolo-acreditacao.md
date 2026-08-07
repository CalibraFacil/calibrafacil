# NIE-Cgcre-009 — uso do símbolo da acreditação no certificado

**Fonte primária lida.** `NIE-CGCRE-009`, **Revisão 27, publicada em Jul/2024**, 22 páginas.
Obtida do espelho oficial da Cgcre no gov.br (CDTN):
`gov.br/cdtn/pt-br/centrais-de-conteudo/documentos-cgcre-abnt-nbr-iso-iec-17025/nie-cgcre-9`.

Fecha o item 2 da §5 de [`certificados-requisitos-normativos.md`](./certificados-requisitos-normativos.md),
que registrava dimensão, posição, proporção e cor do selo como **desconhecidas**.
Documento de referência dela: **ILAC P8:11/2023**. Complementa a **Portaria Inmetro nº 274/2014**
e o Catálogo de marcas do Inmetro.

---

## 1. Posição na página — regra dura

**§11.5.2** — *"O símbolo da acreditação deve ser colocado na **primeira página** do relatório ou
do certificado."*

Quando houver mais de uma folha, a partir da segunda o laboratório **pode** substituir o símbolo
por uma frase. Para laboratório de calibração o texto é dado literalmente:

> "Laboratório de Calibração acreditado pela Cgcre de acordo com a ABNT NBR ISO/IEC 17025, sob o
> número CAL XXX"

Isso é exatamente a convenção de página de continuação que a UKAS LAB 5 (Fig. 2) e o certificado
DAkkS alemão usam — agora com citação brasileira e a frase canônica em pt-BR.

**§11.5.1** — o uso é **obrigatório** no certificado caso ele faça referência à acreditação.

## 2. Certificado misto — resolvido, e contra a suposição anterior

**§11.5.3** — para usar o símbolo, o certificado deve conter **somente**:

- a) resultados **acreditados** realizados pelo próprio laboratório, respeitados grandezas, faixas,
  CMC, métodos e tipos de produto de cada serviço acreditado; e
- b) resultados de **provedor externo acreditado** para aquele serviço (§11.5.4/11.5.5).

> **Nota 1** — "certificados, relatórios e laudos **não podem conter referência a quaisquer outros
> documentos que contenham resultados** de exames, calibrações, ensaios, amostragens **não
> acreditados**."

**Consequência:** não existe certificado misto com selo. Ou tudo no certificado está dentro do
escopo acreditado, ou o certificado sai sem símbolo. O comportamento atual do produto — selo
liga/desliga **por certificado inteiro** — está **correto**, e o #865 P0 pode marcar esse item
como resolvido: era decisão de produto sem respaldo, agora tem cláusula.

- **§11.5.5** — não pode emitir com símbolo se **todos** os resultados vierem de provedor externo.
- **§11.5.4** — resultados de provedor externo têm de estar claramente identificados, com nome do
  provedor, número de acreditação e organismo acreditador.
- **§11.5.6** — o certificado com símbolo só pode ser emitido por **signatário autorizado** para os
  serviços acreditados nele incluídos. (Casa com a tabela de signatários autorizados do produto.)
- **§11.5.7** — certificado sem o símbolo **não pode** ser usado ou interpretado como emitido na
  condição de acreditado.

## 3. Que outras marcas podem aparecer na página — restringe o produto

**§11.5.8** — o certificado que contém o símbolo da acreditação **só pode conter** estas outras marcas:

- a) marcas do próprio laboratório ou da organização à qual ele pertence;
- b) marca de cooperação de acreditação (ILAC, IAAC) dos acordos que a Cgcre assina, quando
  autorizado;
- c) marca do Acordo do CIPM, para laboratórios designados; e
- d) marca de rede de laboratórios de órgão regulamentador, quando autorizado (hoje só ANVISA/REBLAS).

> ⚠️ **Marca da CalibraFácil não entra no certificado.** Não estamos em nenhuma das quatro
> categorias. O certificado é do laboratório, não nosso. Isso vale para logo, marca-d'água e
> qualquer assinatura visual de produto. Texto funcional no rodapé (versão do motor de cálculo,
> fingerprints) não é marca — mas não pode virar marca disfarçada.

**§11.5.8.1** — declarações opcionais de reconhecimento mútuo, com texto exato:

- "A Cgcre é signatária do Acordo de Reconhecimento Mútuo da ILAC" e/ou
  "Cgcre is Signatory of the ILAC Mutual Recognition Arrangement"
- idem para a IAAC.

## 4. Geometria, cor e tipografia do símbolo (Anexo A)

- **§10.2** — as proporções do símbolo **devem ser mantidas** na reprodução.
- **§10.3** — a marca do laboratório deve ter proporção (largura × altura) **equivalente** à do símbolo.
- **§10.4** — símbolo e marca do laboratório **não precisam estar justapostos**, mas ambos têm de
  estar **na mesma face** do documento.
- **§10.4.1** — não pode usar o símbolo sozinho (induziria que a Cgcre prestou o serviço).
- **A.6.1** — pode ser impresso em preto: `#000000`; branco `#ffffff`.
- **A.6.2** — **a fonte do símbolo é Arial**, obedecendo a proporcionalidade.
- **A.5 / A.8** — composição em três faixas:
  - faixa superior (ciano, texto preto, 2 linhas): a **norma do esquema de acreditação** —
    `ABNT NBR` / `ISO/IEC 17025`
  - centro: quadrado com gradiente azul + o "a" estilizado + a marca do Inmetro no canto inferior
    esquerdo. Gradiente linear duas cores, de `C100 M51 K20` a `C100 M10 Y50`, midpoint 45; o "a"
    em `C70`
  - faixa inferior (ciano, texto preto): **codificação do tipo + número do acreditado** — `CAL 9999`

> **Não há dimensão mínima em mm no documento.** O que é regulado é **proporção** (§10.2, grid de
> construção A.2), não tamanho absoluto. A pergunta "dimensão mínima" do #865 tem resposta
> negativa e citável: a norma não especifica.

## 5. ⚠️ Achado: nosso selo está na redação PRÉ-Rev.27, com prazo

`packages/shared/src/accreditation.ts:10-18` monta a faixa superior em **três** linhas:

```
Calibração
NBR ISO/IEC
17025
```

A Rev. 27 mudou exatamente isso — o histórico de revisão diz *"os dizeres do símbolo de
acreditação foram alterados"*. A redação vigente (A.5/A.8) é de **duas** linhas e traz **ABNT**:

```
ABNT NBR
ISO/IEC 17025
```

A palavra "Calibração" **não** aparece na faixa superior da Rev. 27 — o tipo de acreditação é
identificado pela norma em cima e pela codificação `CAL` embaixo.

**§4.1 Política de transição:** os OAC têm **3 anos a partir de Jul/2024** para aplicar a mudança
do item A.5 — ou seja, **prazo até Jul/2027**.

Segundo ponto: **A.6.2 exige Arial**, e
`packages/documents/src/AccreditationSeal.tsx:30` declara
`"Carlito, Calibri, Inter, Arial, sans-serif"` — Arial é a quarta opção. No Chromium do Gotenberg
o Carlito quase certamente existe (vem com o LibreOffice) e venceria. Deveria ser
`Arial, "Liberation Sans", Helvetica, sans-serif`.

- [x] Redação da faixa superior corrigida para `ABNT NBR` / `ISO/IEC 17025` em 2 linhas, mesmo
      corpo e peso. `ACCREDITATION_SEAL_TITLE` ("Calibração") e `ACCREDITATION_SEAL_SUBTITLE*`
      deixaram de existir; no lugar entrou `ACCREDITATION_SEAL_SCHEME` + `_LINE1`/`_LINE2`.
- [x] Pilha de fontes invertida: `ACCREDITATION_SEAL_FONT_FAMILY` =
      `Arial, "Liberation Sans", Helvetica, sans-serif`. Carlito e Calibri saíram — o teste
      REQ-ACCR-013 falha se voltarem à frente do Arial.
- [ ] Conferir os cianos das duas faixas (hoje `#00B4EC` em cima e `#00BAF2` embaixo — divergentes
      **entre si**) contra o `C100 M0 Y0 K0` da norma. **Deixado como está de propósito:** a
      conversão CMYK→sRGB depende de perfil, os valores atuais provavelmente vieram da arte
      oficial, e inventar um `#00AEEF` "de tabela" seria trocar um valor conferido por um palpite.
      Resolver com a arte oficial em mãos, não por conversão.

## 6. Suspensão e cancelamento

- **§11.1.12** — suspensão total ou cancelamento: interromper **imediatamente** o uso de todo
  material com o símbolo.
- **§11.1.13** — suspensão parcial ou redução: interromper o uso no que toca ao escopo suspenso.

Casa com `isAccreditationActive` / `shouldRenderAccreditationSeal`
(`packages/shared/src/accreditation.ts:106-118`), que já derruba o selo fora da janela de validade.
A suspensão **parcial** por escopo, porém, não é modelada hoje — só a janela global.

## 7. O que esta norma NÃO diz

Para não repetir o erro da NIT-DICLA-083 (#864 §6), o que foi procurado e **não** existe aqui:

- Não define conteúdo do certificado (isso é ISO/IEC 17025 §7.8 e NIT-Dicla-021).
- Não define tamanho de página, tipografia do documento, ordem de seções nem estilo de tabela.
- Não define dimensão mínima absoluta do símbolo — só proporção.
