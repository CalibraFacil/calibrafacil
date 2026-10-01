# Dossiê de Validação — `@calibra-facil/math-engine` v0.2.4

Referência técnica que registra as verificações do motor matemático do projeto de código aberto Calibra Fácil. Pode servir de insumo para a validação de método e de software que cada laboratório conduz sob a ISO/IEC 17025:2017 (§7.2.2 e §7.11).

> **Isenção de responsabilidade.** Este dossiê não é um documento de aprovação e não contém assinaturas. O software é fornecido "no estado em que se encontra", sem garantia de qualquer tipo, nos termos da [licença MIT](../../../LICENSE). Cada laboratório é o único responsável por validar o software para o seu próprio uso e pelos resultados que emitir.

## Fonte

- `dossier.tex` — fonte LaTeX (única fonte da verdade).
- `Makefile` — pipeline de build.
- O PDF compilado **não é versionado**; gere-o a partir da fonte com `make`.

## Como compilar

Requisitos: TeX Live com `pdflatex` (e idealmente `latexmk`). Em Arch:

```bash
sudo pacman -S texlive-basic texlive-latexrecommended texlive-latexextra texlive-fontsrecommended texlive-langportuguese
```

Build:

```bash
make
```

Produz `dossier.pdf`. Se `latexmk` não estiver disponível, o Makefile cai em duas passadas de `pdflatex` para resolver o sumário e referências cruzadas.

Para iteração contínua:

```bash
make watch
```

## Apêndices

1. **Apêndice A — Planilhas de referência.** Descreve cada planilha usada na camada de comparação operacional (escopo metrológico, vigência). A identificação do laboratório de origem é omitida na edição pública e as planilhas não são redistribuídas.
2. **Apêndice B — Resultados operacionais por cenário.** Para cada cenário executado contra as planilhas: identificação, entradas, valor de referência, valor do motor, desvio observado, tolerância, conclusão.

O dossiê não tem bloco de aprovação nem assinatura; a seção "Natureza deste documento e isenção de responsabilidade" explica o seu alcance.

## Versionamento

Cada versão do pacote `@calibra-facil/math-engine` exige um dossiê próprio. Diretórios por versão:

```
validation/math-engine/v0.2.4/
validation/math-engine/v0.2.5/
...
```

Mudança de `ENGINE_VERSION` exposta pelo pacote requer um novo diretório de dossiê antes do _release_.

## Distribuição

A fonte e o processo de build são públicos: qualquer pessoa pode gerar o PDF com `make`. O documento é fornecido sem garantia, nos termos da licença MIT; cada laboratório permanece o único responsável pela sua própria validação (ISO/IEC 17025:2017 §7.2.2 e §7.11).
