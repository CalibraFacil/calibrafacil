# Dossiê de Validação — `@calibra-facil/math-engine` v0.2.4

Documento controlado que registra a validação do motor matemático conforme distribuído na plataforma CalibraFácil. Serve como evidência reutilizável por laboratórios usuários na composição da sua própria validação de método sob ISO/IEC 17025:2017 §7.2.1.3.

## Fonte

- `dossier.tex` — fonte LaTeX (única fonte da verdade).
- `Makefile` — pipeline de build.
- O PDF compilado **não é versionado**; é gerado a partir da fonte e assinado eletronicamente antes de ser distribuído.

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

## Preenchimento antes da assinatura

O documento é entregue pronto exceto pelos apêndices controlados:

1. **Apêndice A — Planilhas de referência.** Listar cada planilha Excel usada como referência: identificação interna, origem (laboratório acreditado, número Inmetro/RBC), escopo metrológico, data e responsável.
2. **Apêndice B — Resultados operacionais por cenário.** Para cada cenário executado contra as planilhas: identificação, entradas, valor de referência, valor do motor, desvio observado, tolerância, conclusão.

Os campos do bloco de aprovação (responsável pela validação, responsável da qualidade, aprovação técnica) ficam em branco até a assinatura. A versão eletrônica do PDF assinado é a versão controlada.

## Versionamento

Cada versão do pacote `@calibra-facil/math-engine` exige um dossiê próprio. Diretórios por versão:

```
validation/math-engine/v0.2.4/
validation/math-engine/v0.2.5/
...
```

Mudança de `ENGINE_VERSION` exposta pelo pacote requer novo dossiê aprovado antes do *release* em produção.

## Distribuição

O PDF assinado é distribuído mediante solicitação ao laboratório usuário ou ao seu auditor, conforme descrito em `apps/docs/content/docs/incerteza/validacao.mdx`.
