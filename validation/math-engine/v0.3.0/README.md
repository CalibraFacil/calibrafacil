# Dossiê de Validação — `@calibra-facil/math-engine` v0.3.0

Documento controlado que registra a validação do motor matemático conforme distribuído na plataforma CalibraFácil. Serve como evidência reutilizável por laboratórios usuários na composição da sua própria validação de método sob ISO/IEC 17025:2017 §7.2.1.3.

## Revisões do documento

| Rev. | Data       | Descrição                                                                                                                                                                                                                                                                                                                      |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.0  | 2026-06-09 | Emissão inicial para a v0.3.0.                                                                                                                                                                                                                                                                                                 |
| 1.1  | 2026-09-08 | Revalidação sob a mesma versão após a auditoria técnica de 2026-09-07 (19 achados, `docs/audits/math-engine-2026-09-07*.md`); camada 3 + gate documentados; evidência da camada 1 reimplementada em `src/gum/reference-evidence.spec.ts`; corrigidas as declarações sobre truncamento de ν_eff e limiar da aproximação normal. |

A revisão do documento (`\docRevision`) é independente da versão do pacote (`\docVersion`): uma revisão registra alterações que **não** mudam nenhum resultado já validado; qualquer mudança de resultado exige nova versão do pacote e novo diretório de dossiê.

## Fonte

- `dossier.tex` — fonte LaTeX (única fonte da verdade).
- `Makefile` — pipeline de build.
- O PDF compilado **não é versionado**; é gerado a partir da fonte e assinado eletronicamente antes de ser distribuído.
- `manifest.json` — **sidecar legível por máquina** (DOM-11 / #664). Espelha a
  versão validada e fixa um _fingerprint_ de referência do motor para o gate
  automatizado. Ver abaixo.

## Gate automatizado motor ↔ dossiê (`manifest.json`)

O `dossier.tex` declara a versão validada como texto (`\docVersion`) mas **não
registra um fingerprint legível por máquina**. Para permitir uma checagem
automatizada de que o motor em produção corresponde a este dossiê, o
`manifest.json` adjacente é a fonte da verdade parseável:

```json
{
  "engineVersion": "0.3.0",
  "referenceFormula": "reference + correction - drift",
  "fingerprint": "sha256:<digest>"
}
```

- `engineVersion` — deve ser idêntico a `\docVersion` no `dossier.tex` e à
  constante `ENGINE_VERSION` do pacote.
- `referenceFormula` — modelo canônico (sem literais numéricos nem funções
  transcendentais, portanto reproduzível bit a bit entre _runtimes_) que o gate
  recompila para obter o fingerprint do motor.
- `fingerprint` — `formulaFingerprint` (SHA-256 canônico sobre AST + opções +
  versão) que o motor validado produz ao compilar `referenceFormula`. Valor
  **extraído do motor real** e fixado como _baseline_. ⚠️ **Ainda NÃO ratificado
  por revisão humana** — a ratificação metrológica do modelo de referência e
  deste fingerprint é um bloqueio de merge (ver PR #664/DOM-11). O gate detecta
  fielmente qualquer divergência _futura_ deste baseline; se o próprio baseline
  for corrigido na ratificação, atualize este valor.

O teste `packages/math-engine/src/audit/engine-dossier-gate.spec.ts` falha se
`ENGINE_VERSION` divergir da versão do dossiê vigente (REQ-DOM-GAT-001) ou se o
motor não reproduzir o `fingerprint` registrado (REQ-DOM-GAT-002). Qualquer
`release` que mude `ENGINE_VERSION` exige novo diretório de dossiê **com seu
próprio `manifest.json`** antes de passar no gate.

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

Mudança de `ENGINE_VERSION` exposta pelo pacote requer novo dossiê aprovado antes do _release_ em produção.

## Distribuição

O PDF assinado é distribuído mediante solicitação ao laboratório usuário ou ao seu auditor, conforme descrito em `apps/docs/content/docs/incerteza/validacao.mdx`.
