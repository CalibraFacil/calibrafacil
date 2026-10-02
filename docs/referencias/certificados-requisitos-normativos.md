# Certificado de calibração — o que a norma exige e o que ela deixa livre

Documento operacional para decidir **conteúdo e aparência** do certificado de calibração.
Reconstruído a partir de 72 transcrições de sessões de pesquisa anteriores (163 fontes,
78 identificadores normativos), cruzado com as citações presentes no código que já roda.

Índice de fontes: [`metrologia-fontes.md`](./metrologia-fontes.md).

---

## ⚠️ Leia isto antes de usar

**1. Esta pesquisa nunca leu a cláusula 7.8 de forma sistemática.** Todas as sessões
anteriores foram dirigidas a problemas pontuais — piso de CMC, regra de decisão, intervalos
de recalibração, retificação de certificado. Ninguém sentou e leu §7.8.2 (conteúdo comum de
relatórios) e §7.8.4 (requisitos específicos de certificados de calibração) de ponta a ponta.
Por isso a maior parte dos campos clássicos de um certificado aparece abaixo como
**`não determinado pela pesquisa`** — o que significa "não sabemos", **não** "a norma é omissa".

> **Primeira ação antes de qualquer redesenho:** ler §7.8.2 e §7.8.4 da ISO/IEC 17025:2017 na
> fonte primária e preencher as lacunas desta tabela. Sem isso, o redesenho parte de uma
> matriz incompleta — que é exatamente o erro que custou o editor visual (#863).

**2. Achado de pesquisa tem prazo de validade.** Ver [§7](#7-achados-que-já-expiraram) — pelo
menos um achado central desta base já estava obsoleto quando foi recuperado.

**3. Números de NIT/DOQ são reciclados pela Cgcre.** A NIT-DICLA-083 já teve dois assuntos
completamente diferentes em revisões distintas. Citar um número sem revisão e sem título não
é citação — ver [§6](#6-a-má-citação-que-quase-virou-requisito).

---

## 1. Requisitos confirmados

Só entra aqui o que tem cláusula ou documento identificado nos registros de pesquisa.

| Requisito                                                   | Norma e item                                                                   | Obrigatoriedade                                                | O que isso força no layout                                                                                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incerteza expandida nunca abaixo da CMC publicada no escopo | ILAC-P14:09/2020 §5 (adotada pela Cgcre para RBC)                              | obrigatório na emissão acreditada                              | Nada no PDF. É guarda de emissão — bloqueio antes da assinatura.                                                                                                                                               |
| Arredondamento de U e do valor medido                       | ILAC-P14:09/2020 §5 + convenção EURAMET cg-18                                  | obrigatório na emissão acreditada                              | U com **2 algarismos significativos**, k=2 (~95%), valor relatado na **mesma casa decimal de U**. Fixa as casas decimais das colunas de erro e incerteza.                                                      |
| Indicação do fator de abrangência / probabilidade           | ILAC-P14:09/2020                                                               | obrigatório se há incerteza relatada                           | Precisa aparecer; **onde** não é prescrito (rodapé, célula, texto corrido — todos aparecem como prática).                                                                                                      |
| Declaração da regra de decisão aplicada                     | ISO/IEC 17025:2017 **§7.8.6** + ILAC-G8:09/2019 (+ §7.1, acordo com o cliente) | condicional — obrigatório quando há declaração de conformidade | Um texto associado ao veredito informando a regra (especificação de referência + banda de guarda `g`). A **forma visual** do veredito não é prescrita.                                                         |
| Símbolo de acreditação só sobre serviço dentro do escopo    | ILAC-P8:11/2023 + NIE-Cgcre-009                                                | obrigatório para emitir com selo RBC                           | Regra de **elegibilidade**, não de posição. A presença do selo tem de derivar do escopo real do job, não do template.                                                                                          |
| Campos da linha de escopo e formatos de CMC                 | DOQ-CGCRE-057                                                                  | obrigatório para RBC                                           | A CMC é polimórfica — valor fixo, fórmula `a + b·x`, ou tabela por sub-faixa. Afeta o modelo de dados do escopo, não o certificado.                                                                            |
| Apresentação de resultado e incerteza                       | NIT-DICLA-021                                                                  | obrigatório para RBC                                           | ⚠️ **A norma nunca foi lida.** Sabemos que ela governa isso; não sabemos o que exige. Ver [§5](#5-lacunas-que-bloqueiam-o-redesenho).                                                                          |
| Quem pode assinar pelo laboratório acreditado               | NIT-DICLA-019 rev. 03                                                          | obrigatório para RBC                                           | Bloco de assinatura precisa identificar o signatário de forma rastreável à lista de signatários autorizados. Formato do bloco: livre.                                                                          |
| Retificação / certificado substituto                        | ISO/IEC 17025:2017 **§7.8.8** + EA FAQ 50.1 e 45.2                             | condicional — quando um certificado emitido é alterado         | O substituto precisa de identificação única **e** referência explícita ao original substituído, com as alterações identificáveis dentro do documento. Já implementado como bloco "substitui" no template XLSX. |
| Separação as-found × as-left                                | disciplina associada ao ILAC-G24:2022                                          | condicional — quando há ajuste durante o serviço               | Os dois conjuntos têm de ficar distinguíveis, e o veredito impresso deriva **exclusivamente** do as-found.                                                                                                     |
| Validade jurídica do arquivo assinado                       | **MP 2.200-2** (ICP-Brasil) + DOC-ICP-15.03                                    | obrigatório                                                    | Condição sobre o **arquivo**, não sobre a página. Nada obriga carimbo visível, página de assinatura ou QR.                                                                                                     |
| Recomendação de intervalo de recalibração                   | NIST SOP-1 (Certificate Evaluation) — não incluir salvo acordo com o cliente   | condicional                                                    | Ver [§4](#4-a-trava-de-próxima-calibração-tem-base--mas-não-a-que-supúnhamos).                                                                                                                                 |

### Metrologia legal (documentos que não são certificado de calibração)

| Documento                                             | Norma                                                       | Conteúdo evidenciado                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comprovante de Entrega (oficina permissionária)       | Portaria Inmetro nº 65/2015                                 | Identificação do instrumento + portaria de aprovação de modelo dele (ex.: nº 157/2022 para balança) + registro Inmetro; classe de exatidão; aviso de verificação obrigatória no IPEM/RBMLQ-I; nº do lacre/Marca de Reparo; quem entregou e recebeu; garantia e prazo de armazenamento. |
| Marca de Reparo                                       | RTM específico do instrumento — **não existe número único** | Selo aposto após reparo sob controle metrológico legal. Termo oficial atual é "Marca de Reparo" (não "Etiqueta de Reparo"). Descrever em termos gerais e remeter ao RTM da categoria.                                                                                                  |
| Identificação da permissionária (nº autorização + UF) | não determinado pela pesquisa                               | —                                                                                                                                                                                                                                                                                      |

> **RBC ≠ metrologia legal.** São regimes, competências e documentos distintos, sem sobreposição
> encontrada. Uma mesma balança pode receber um certificado RBC — onde a classe de exatidão do
> OIML R 76-1 (via Portaria Inmetro nº 236) é só critério de aceitação acordado com o cliente — e,
> noutro momento, um Comprovante de Entrega de oficina permissionária. Não unifique os fluxos.

---

## 2. `não determinado pela pesquisa` — as lacunas da tabela

Estes campos **não** foram pesquisados. Presumir que são livres seria repetir o erro do editor.

Identificação única do certificado (caso geral) · numeração de páginas e marca de fim de
documento · identificação e endereço do laboratório · identificação do cliente · identificação
e condição do item · datas (recebimento, calibração, emissão) · método utilizado · condições
ambientais · declaração de rastreabilidade (§6.5 só é citada de passagem) · resultados com
unidades · opiniões e interpretações (§7.8.7) · declaração de "não reproduzir exceto na íntegra"
· assinatura/autorização.

Todos vivem em **§7.8.2 e §7.8.4**. Uma leitura dirigida resolve a seção inteira.

---

## 3. O que a norma **não** prescreve

Evidenciado por iterações de design em que a equipe alterou estes elementos repetidamente
**sem nunca citar uma cláusula** — em contraste direto com a tabela da §1, onde há sempre uma.

- **Tipografia** — troca de fonte de títulos, monoespaçada para identificadores.
- **Paleta de cores** — tom do indicador de veredito, barras sólidas × tons suaves.
- **Iconografia** — símbolo de verificação desenhado à mão trocado por ícone de biblioteca.
- **Forma visual do veredito** — selo, medalhão, badge: só se exige _declarar_ a regra de decisão.
- **Número de páginas e agrupamento de seções** — o mesmo conteúdo já foi reorganizado de mais
  para menos seções por legibilidade, sem objeção normativa.
- **Estilo de tabela** — zebrado, destaque de cabeçalho, margens, alinhamento.
- **Tamanho de página** — A4 é o que se usa; nenhuma exigência normativa encontrada.
- **Proeminência do selo de acreditação na composição** — tratá-lo como âncora gráfica foi ênfase
  de design, não prescrição.

**Silêncio, não liberdade confirmada:** ordem das colunas nas tabelas de resultado, orientação
da página, posicionamento de logotipos do laboratório. Ninguém pesquisou — não assuma.

> Tua leitura original — _"cgcre doesnt define whats required or not"_ — está **certa** quanto ao
> layout e **errada** quanto ao conteúdo. O que é prescrito é um conjunto pequeno de conteúdos e
> regras de elegibilidade. A diagramação é livre.

---

## 4. A trava de "próxima calibração" tem base — mas não a que supúnhamos

O produto tem uma guarda de compilação que bloqueia qualquer vínculo a "próxima calibração"
em qualquer posição do template. A pesquisa internacional **não achou cláusula ISO/ILAC** que
exija ou proíba isso — o que faria parecer política de produto disfarçada de conformidade.

Mas a pesquisa do audit pack achou a base real: **NIST SOP-1** orienta a não incluir recomendação
de intervalo de recalibração **salvo acordo com o cliente**. A trava é legítima; a justificativa
registrada é que estava errada. Se o redesenho quiser exibir validade sugerida, o caminho é
condicionar ao acordo com o cliente — não remover a guarda.

---

## 5. Lacunas que bloqueiam o redesenho

Por ordem de impacto:

1. **§7.8.2 e §7.8.4 da ISO/IEC 17025:2017** — 🟡 **ENUMERAÇÃO OBTIDA, redação pendente.**
   Ver [`iso-17025-7.8-conteudo.md`](./iso-17025-7.8-conteudo.md): a lista completa de campos
   (§7.8.2.1 a–p, §7.8.4.1 a–f, §7.8.4.2, §7.8.4.3, §7.8.6.1/.2) veio de material de treinamento
   de um organismo acreditador que cita as cláusulas — fonte secundária de boa procedência,
   suficiente para projetar o layout, **insuficiente para dar a §2 por fechada**. As cópias
   piratas seguem "não utilizar"; a redação literal tem de vir da cópia licenciada ABNT do
   laboratório. Achado que já muda o produto: **§7.8.4.3** é a base real da trava de "próxima
   calibração" (não a NIST SOP-1 da §4 abaixo), e a leitura expôs 5 campos obrigatórios que
   hoje não modelamos — marca de fim de documento, desvios ao método, resultados de provedor
   externo, declaração de rastreabilidade e condição/data de recebimento do item.
2. ~~**NIE-Cgcre-009**~~ — ✅ **FECHADO.** Rev. 27 (Jul/2024) obtida e lida na fonte primária.
   Ver [`nie-cgcre-009-simbolo-acreditacao.md`](./nie-cgcre-009-simbolo-acreditacao.md).
   Em resumo: símbolo obrigatório na **primeira página** (§11.5.2), com frase substituta canônica
   a partir da segunda; **proporção** é o que se regula, **não há dimensão mínima em mm**;
   fonte do símbolo é **Arial** (A.6.2); pode ser impresso em preto (A.6.1); e só marcas de 4
   categorias podem coexistir na página — **a nossa não é uma delas** (§11.5.8).
   Achado colateral: nosso selo está na redação **pré-Rev.27**, com prazo até **Jul/2027**.
3. ~~**NIT-DICLA-021**~~ — ✅ **FECHADO.** Rev. 10 (Jul/2020) obtida e lida.
   Ver [`nit-dicla-021-incerteza.md`](./nit-dicla-021-incerteza.md). Seu **Anexo A é a EA-4/02
   em português**, já adaptada à ILAC-P14 — as 46 citações de EA-4/02 no código são, por adoção,
   norma brasileira. Regras que valem para o layout: `U` com **no máximo 2 algarismos
   significativos** e o valor arredondado à última casa de `U` (A.6.3); **proibido o sinal `±` em
   tabela** (A.6.1 Nota 1); `k` e probabilidade de abrangência **obrigatórios**, com duas frases
   canônicas conforme se usou ou não o Apêndice E (A.6.1.1 / A.6.2); `U` declarado **nunca menor
   que a CMC**, sob pena de ser considerado serviço fora do escopo (A.6.5).
4. ~~**Certificado misto**~~ — ✅ **FECHADO** pela NIE-Cgcre-009 §11.5.3 + Nota 1: certificado com
   símbolo contém **somente** resultados acreditados (próprios ou de provedor externo acreditado),
   e não pode nem referenciar documento com resultado não acreditado. **Não existe certificado
   misto com selo.** O liga/desliga por certificado inteiro que o produto já faz está correto.
5. **Consulta formal à Cgcre** sobre exigência de assinatura digital — pendência registrada e
   nunca fechada. Não existe documento Cgcre/Inmetro exigindo ICP-Brasil ou RFC 3161 em
   certificado de calibração; a exigência vem da lei geral.

---

## 6. A má citação que quase virou requisito

**NIT-DICLA-083 foi citada como base normativa para exigir assinatura ICP-Brasil e carimbo de
tempo RFC 3161.** É falso. A revisão vigente (Rev. 01) trata de acreditação de laboratórios que
calibram com materiais de referência certificados — rastreabilidade de padrão, nada a ver com
assinatura eletrônica. Uma Rev. 00 de 2001, com o mesmo número, tratava de outro assunto ainda:
**a Cgcre recicla números entre revisões.**

Busca extensiva em `gov.br/inmetro`, `gov.br/cdtn` e material de workshop Cgcre **não encontrou
nenhum** documento do Inmetro/Cgcre exigindo assinatura ICP-Brasil ou RFC 3161 em certificado de
calibração. Candidatos descartados: NIT-DICLA-019 (trata de _quem_ assina, não do padrão técnico)
e DOQ-CGCRE-066 (assunto não relacionado).

Base correta: **MP 2.200-2** (validade jurídica) + **DOC-ICP-15.03** (padrão técnico PAdES).
Correção já aplicada no código — as duas menções remanescentes a NIT-DICLA-083 são notas
explícitas de retratação apontando para #646, que é a forma certa de fazer isso.

**Lição operacional:** número de NIT/DOQ sem revisão e sem título não é citação. E uma norma de
acreditação metrológica não é fonte para questão de direito digital — o erro foi de _categoria_,
não de dígito.

---

## 7. Achados que já expiraram

| Achado registrado                                                      | Situação real                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "O produto assina em PAdES-BES (≈AD-RB), sem carimbo de tempo nem LTV" | **Obsoleto.** #706 entregou o pipeline PAdES-T com RFC 3161 fail-closed; #707 somou revogação por CRL. O código ainda registra se a ACT é credenciada ICP-Brasil (rotulagem honesta).                                          |
| "ISO/IEC 17025:2025 foi publicada" (blogs de terceiros)                | **Refutado** por sessão dedicada e reconfirmado hoje: 2017 segue vigente, estágio 90.93, revisão em curso no CASCO WG44, nada publicado. `iso.org` bloqueia fetch automatizado — confirme no navegador antes de apostar nisso. |

**Divergência aberta — marketing × código.** O material de marketing descreve a assinatura como
PAdES com certificado A1, carimbo de tempo **e validação de cadeia** (≈AD-RC / B-LT). O código
passa `enableLtv: false` explicitamente (`apps/worker/src/index.ts:891`), e `ltvEnabled` tem
default `false` em `packages/signing/src/signer.ts:266`. Carimbo de tempo: entregue. Validação de
longo prazo: **não**. Reconciliar a cópia antes de tratá-la como especificação — é um produto
regulado e a afirmação é verificável por qualquer auditor.

---

## 8. Normas citadas no código sem rastro de pesquisa

Cruzando as citações do código com as das transcrições, estas aparecem **no produto** e
praticamente **não aparecem na pesquisa** — são as citações mais arriscadas que existem, porque
já estão em produção e ninguém registrou de onde vieram:

| Norma                        | Onde está no código                                                                           | Peso      |
| ---------------------------- | --------------------------------------------------------------------------------------------- | --------- |
| **EA-4/02 M:2022**           | `packages/method-templates/src/templates/*` — 46 referências com §, é o framework GUM adotado | altíssimo |
| ISO 376                      | `force-indication.ts`                                                                         | alto      |
| ISO 4787:2010                | `volume-glassware.ts` (origem da Eq. 1)                                                       | alto      |
| UKAS LAB 14 ed. 8 (dez/2025) | `weighing-instrument.ts`, `mass-balance.ts` — corroboração; §1.2 remete à cg-18               | médio     |
| ISO 7500-1                   | `force-indication.ts`                                                                         | médio     |

---

## 9. Edições a confirmar

Aplicadas no produto, sem ano/revisão registrado. Pela regra permanente do projeto de fundamentar
decisões na edição corrente de fonte primária, cada uma é um defeito latente:

**NIT-DICLA-026** (a própria nota pede confirmação da "rev. 15"; governa o ciclo de 4 anos de EP) ·
**EURAMET cg-18** (usada para arredondamento em certificados reais; uma sessão admite que o texto
nunca foi lido — citação herdada do certificado do cliente) · **EURAMET cg-04** (orçamento de força
explicitamente incompleto: faltam histerese/creep, deriva de zero, reprodutibilidade, temperatura) ·
**OIML R 76-1 / Portaria Inmetro nº 236** (base do veredito em certificados de pesagem reais) ·
**DOQ-CGCRE-057** · **NIT-DICLA-021** · **EURAMET cg-15** · **EURAMET cg-19** · **OIML R 111** ·
**JCGM 106**.

---

## 10. Como manter isto vivo

- Toda citação nova entra com **documento + revisão + ano + link canônico**. Número solto não vale.
- Achado de pesquisa que vira decisão de produto: registrar em qual arquivo aterrissou.
- Quando um achado for corrigido, **deixe a retratação no lugar** (modelo: as notas de
  NIT-DICLA-083 apontando para #646) em vez de apagar — a retratação é que evita a recaída.
