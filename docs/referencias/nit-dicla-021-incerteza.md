# NIT-DICLA-021 — declaração da incerteza no certificado

**Fonte primária lida.** `NIT-DICLA-021`, **Revisão 10, aprovada em JUL/2020**, 27 páginas.
Obtida do espelho oficial da Cgcre no gov.br (CDTN). Cópia em
[`normas-cgcre/NIT-DICLA-021-rev10-jul2020.pdf`](./normas-cgcre/NIT-DICLA-021-rev10-jul2020.pdf).

Fecha o item 3 da §5 de [`certificados-requisitos-normativos.md`](./certificados-requisitos-normativos.md).

> **O Anexo A desta norma É a EA-4/02 em português.** A Nota 2 do Anexo A diz: emitido em
> janeiro de 1999 como a Versão Brasileira da EA-4/02, traduzido com autorização da EA, e
> **alterado depois para se adequar à ILAC P14**. Ou seja: as 46 citações de `EA-4/02 M:2022`
> nos templates de método não são citação estrangeira solta — são a norma brasileira aplicável,
> por adoção. E a ILAC-P14 já está incorporada.

---

## A.6.1 — forma do resultado

O resultado relatado deve incluir o valor medido `y` **e** a incerteza expandida `U`, normalmente
como `(y ± U)`, ambos na unidade da grandeza, ou com `U` em termos relativos (`U/|y|`).
**"Os resultados podem ainda ser apresentados em forma de tabela."**

> ⚠️ **Nota 1 — regra dura de formatação, e fácil de errar:**
> o sinal `±` **só** pode preceder `U` quando o resultado completo é transcrito como `y ± U`.
> *"Quando da apresentação dos valores medidos e suas respectivas incertezas de medição em uma
> tabela, **não é correto utilizar o sinal ±**. Neste caso, deve-se relatar apenas o valor de U
> isoladamente."* Também não se usa `±` quando `U` aparece separado, na forma `U = 0,3 °C`.

**Consequência para o layout:** nossa tabela de resultados tem coluna `U` com valor puro, **sem
`±`, sem `+/-`**, e o cabeçalho não pode trazer `±`. Um cabeçalho tipo `U ± · kg` viola a Nota 1.

## A.6.1.1 / A.6.2 — k e probabilidade de abrangência são obrigatórios

O fator de abrangência `k` e a probabilidade de abrangência **devem ser relatados no certificado**,
com nota explicativa. A norma dá o texto:

**Caso geral (A.6.1.1):**

> "A incerteza expandida de medição relatada é declarada como a incerteza padrão da medição
> multiplicada pelo fator de abrangência k, de tal forma que a probabilidade de abrangência
> corresponda a aproximadamente 95%."

**Quando se usou o Apêndice E — t-Student por graus de liberdade efetivos (A.6.2):**

> "A incerteza expandida de medição relatada é declarada como a incerteza padrão de medição
> multiplicada pelo fator de abrangência k = XX, o qual para uma distribuição t com veff = YY
> graus de liberdade efetivos corresponde a uma probabilidade de abrangência de aproximadamente
> 95%. A incerteza padrão da medição foi determinada de acordo com a publicação EA-4/02."

**É a segunda que nos serve na maioria dos casos.** Os métodos que derivam `k` por
Welch-Satterthwaite + `student_t_inverse_2t` (`mass-balance`, `weighing-instrument`,
`force-indication`, `frequency-indication`) estão exatamente no procedimento do Apêndice E —
então a nota tem de trazer `k` e `veff` preenchidos, não a frase genérica.

`electrical-indication` e `humidity-magnus` fixam `k = 2` literal, sem `veff`: para esses vale a
frase do A.6.1.1, com `k = 2`.

> Consequência: **a nota de incerteza é condicional ao método**, não um texto fixo do rodapé.

## A.6.3 — arredondamento (fecha a questão da EURAMET cg-18)

> "O valor numérico da incerteza expandida deve ser apresentado com **no máximo dois algarismos
> significativos**. O valor numérico do resultado da medição, em sua forma final, deve ser
> **arredondado para o último algarismo significativo do valor da incerteza expandida**, atribuída
> ao resultado da medição. Para o processo de arredondamento, as regras usuais de arredondamento
> de números devem ser utilizadas aplicando-se as orientações estabelecidas na **seção 7 do ISO
> GUM**."
>
> Nota — para mais informações sobre arredondamento, ver **ISO 80000-1:2009**.

Isto é a regra que o produto já queria aplicar, agora com **fonte brasileira primária e vigente**.

**#865 P1 pode ser fechado por outro caminho.** A preocupação era que o arredondamento de 2
algarismos significativos repousasse sobre a EURAMET cg-18, citação herdada do certificado de um
cliente e nunca lida. **Não repousa** — A.6.3 basta, é norma Cgcre, e diz o mesmo. A cg-18 vira
corroboração opcional, não base. Se quisermos citar algo no certificado, o correto é a
NIT-DICLA-021 (ou o ISO GUM §7), não a cg-18.

Nuance a respeitar: a norma diz **"no máximo dois"**, não "exatamente dois". Relatar `U` com 1
algarismo significativo é conforme. Nosso formatador deve tratar 2 como teto, não como alvo.

## A.6.5 — piso da CMC, com a penalidade escrita

> "A incerteza de medição declarada no certificado de calibração **não pode ser menor que a
> Capacidade de Medição e Calibração (CMC)** constante no escopo de acreditação do laboratório
> para o serviço realizado."
>
> Nota — "A declaração de incerteza de medição menor que a CMC é considerada pela Cgcre como a
> **realização de um serviço fora do escopo da acreditação** e implica nas penalidades previstas
> na NIT-Dicla-031."

Esta é a citação brasileira da guarda que o produto já implementa em
`packages/shared/src/scope-compliance.ts` e que a §1 do documento normativo atribuía à
ILAC-P14:09/2020 §5. As duas valem; a NIT-DICLA-021 acrescenta a consequência regulatória.

## A.6.4 — o que a incerteza tem de cobrir

Deve incluir as contribuições de curto prazo obtidas durante a calibração **e** as atribuíveis ao
dispositivo calibrado. Onde aplicável, deve cobrir as mesmas contribuições consideradas na
avaliação da CMC, trocando os componentes do "melhor dispositivo existente" pelos do dispositivo
efetivamente calibrado.

---

## O que esta norma NÃO diz

- Não trata de tipografia, tamanho de página, ordem de seções nem estilo de tabela. A única regra
  de *apresentação* é a Nota 1 do A.6.1 (proibição do `±` em tabela) e o A.6.3 (arredondamento).
- Não trata do conteúdo geral do certificado (§7.8.2 da ISO/IEC 17025 continua pendente).
- Não trata do símbolo de acreditação — isso é a
  [NIE-Cgcre-009](./nie-cgcre-009-simbolo-acreditacao.md).
