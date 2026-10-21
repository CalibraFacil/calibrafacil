# Dossiê de Validação — `@calibra-facil/math-engine` v0.4.0

Referência técnica que registra as verificações do motor matemático do projeto de código aberto Calibra Fácil. Pode servir de insumo para a validação de método e de software que cada laboratório conduz sob a ISO/IEC 17025:2017 (§7.2.2 e §7.11).

> **Isenção de responsabilidade.** Este dossiê não é um documento de aprovação e não contém assinaturas. O software é fornecido "no estado em que se encontra", sem garantia de qualquer tipo, nos termos da [licença MIT](../../../LICENSE). Cada laboratório é o único responsável por validar o software para o seu próprio uso e pelos resultados que emitir.

## Revisões do documento

| Rev. | Data       | Descrição                                                                                                                                                                                                                                                                                                                        |
| ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0  | 2026-09-08 | Emissão inicial para a v0.4.0 (sucede `v0.3.0` rev. 1.1): aritmética exata em todo o modo decimal; Welch–Satterthwaite generalizada para grandezas correlacionadas (Castrup 2010/2020 Eq. 46; Willink 2007); guarda de versão na execução.                                                                                       |
| 1.1  | 2026-10-01 | Edição pública para a distribuição em código aberto (licença MIT): bloco de aprovação e assinatura substituído pelo aviso de isenção de responsabilidade; identificação do laboratório de origem removida. Conteúdo técnico inalterado.                                                                                          |
| 1.2  | 2026-10-20 | Evidências adicionais, sem alteração de código nem de resultado: `manifest.json` registra o SHA-256 do código-fonte do motor e cinco resultados de propagação completos; exemplos resolvidos do EA-4/02 M:2022 reproduzidos a partir dos dados brutos; limitação 9; texto de precisão numérica esclarecido (exato × `binary64`). |

A revisão do documento (`\docRevision`) é independente da versão do pacote (`\docVersion`): uma revisão registra alterações que **não** mudam nenhum resultado já validado; qualquer mudança de resultado exige nova versão do pacote e novo diretório de dossiê — foi o caso desta versão (ver `docs/audits/math-engine-0.4.0-release.md`).

## Fonte

- `dossier.tex` — fonte LaTeX (única fonte da verdade).
- `Makefile` — pipeline de build.
- O PDF compilado **não é versionado**; gere-o a partir da fonte com `make`.
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
  "engineVersion": "0.4.0",
  "referenceFormula": "reference + correction - drift",
  "fingerprint": "sha256:<digest>",
  "engineOptions": {
    "numericMode": "decimal",
    "rejectUnusedInputs": true,
    "maxExponentMagnitude": 12,
    "maxSignificantDigits": 24
  }
}
```

- `engineVersion` — deve ser idêntico a `\docVersion` no `dossier.tex` e à
  constante `ENGINE_VERSION` do pacote.
- `referenceFormula` — modelo canônico (sem literais numéricos nem funções
  transcendentais, portanto reproduzível bit a bit entre _runtimes_) que o gate
  recompila para obter o fingerprint do motor.
- `fingerprint` — `formulaFingerprint` (SHA-256 canônico sobre AST + opções +
  versão) que o motor validado produz ao compilar `referenceFormula` **sob
  `METHOD_ENGINE_OPTIONS`**, a configuração usada por todos os caminhos que
  emitem certificado (API na nuvem, servidor local do desktop, modelos de
  método). O fingerprint incorpora as opções normalizadas, então um gate rodado
  com os padrões do motor autenticaria outro contrato numérico. Valor
  **extraído do motor real** e fixado como _baseline_. ⚠️ **Ainda NÃO ratificado
  por revisão humana** — a ratificação metrológica do modelo de referência e
  deste fingerprint é um bloqueio de merge (ver PR #664/DOM-11). O gate detecta
  fielmente qualquer divergência _futura_ deste baseline; se o próprio baseline
  for corrigido na ratificação, atualize este valor.

- `engineOptions` — a configuração de produção que o `fingerprint` autentica,
  registrada em texto legível para que uma alteração em `METHOD_ENGINE_OPTIONS`
  apareça como ela mesma e não apenas como um digest divergente. Opcional em
  dossiês emitidos antes do campo existir; o gate exige-o do dossiê vigente.

- `sourcePin` (rev. 1.2, aditivo) — SHA-256 do código-fonte do motor: todo
  `src/**/*.ts` exceto especificações, `src/testing/` e a maquinaria do gate
  (`engine-dossier-gate.ts`, `source-pin.ts`, `propagation-goldens.ts`). `sha256` é
  o digest da listagem `<sha256 do arquivo>  <caminho>` (formato `sha256sum`) em
  ordem de caminho, com CRLF normalizado para LF; `files` traz o digest de cada
  arquivo para que uma falha nomeie os arquivos alterados. A versão **não** é
  derivada do digest (certificados e dossiês citam `0.4.0`): o digest fixa o código
  à versão.
- `propagationGoldens` (rev. 1.2, aditivo) — cinco modelos completos de medição
  (cópia das entradas e saídas esperadas em texto canônico: valor, `u_c`, `ν_eff`,
  `k`, `U`, sensibilidades e _fingerprint_ de cálculo), avaliados sob
  `METHOD_ENGINE_OPTIONS`. Os modelos moram em
  `src/audit/propagation-goldens.ts`; o teste exige que a cópia do manifesto seja
  idêntica.

O teste `packages/math-engine/src/audit/engine-source-pin.spec.ts` falha se
`ENGINE_VERSION` divergir da versão do `package.json` (REQ-DOM-GAT-003), se o
código-fonte não corresponder ao `sourcePin` (REQ-DOM-GAT-004) ou se algum
resultado de propagação divergir dos fixados (REQ-DOM-GAT-005). **Qualquer
alteração de byte em `packages/math-engine/src`, inclusive comentário ou
formatação, reprova o gate.** Uma liberação deliberada: (1) incremente
`ENGINE_VERSION` e `version` do pacote; (2) crie `validation/math-engine/v<nova>/`
com `dossier.tex` e um `manifest.json` copiado deste **sem** `sourcePin` e
`propagationGoldens` (atualize `engineVersion` e `fingerprint`); (3) rode
`pnpm --filter @calibra-facil/math-engine run engine:pin` (`engine:pin:check` não
grava nada); (4) quantifique a diferença numérica no novo dossiê. O comando
recusa-se a reescrever evidências já fixadas para uma versão.

O teste `packages/math-engine/src/audit/engine-dossier-gate.spec.ts` falha se
`ENGINE_VERSION` divergir da versão do dossiê vigente (REQ-DOM-GAT-001), se o
motor não reproduzir o `fingerprint` registrado, ou se `METHOD_ENGINE_OPTIONS`
divergir de `engineOptions` (REQ-DOM-GAT-002). Qualquer
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

## Apêndices

1. **Apêndice A — Planilhas de referência.** Descreve cada planilha usada na camada de comparação operacional (escopo metrológico, vigência). A identificação do laboratório de origem é omitida na edição pública e as planilhas não são redistribuídas.
2. **Apêndice B — Resultados operacionais por cenário.** Para cada cenário executado contra as planilhas: identificação, entradas, valor de referência, valor do motor, desvio observado, tolerância, conclusão.

O dossiê não tem bloco de aprovação nem assinatura; a seção "Natureza deste documento e isenção de responsabilidade" explica o seu alcance.

## Versionamento

Cada versão do pacote `@calibra-facil/math-engine` exige um dossiê próprio. Diretórios por versão:

```
validation/math-engine/v0.2.4/
validation/math-engine/v0.3.0/
validation/math-engine/v0.4.0/
...
```

Mudança de `ENGINE_VERSION` exposta pelo pacote requer um novo diretório de dossiê antes do _release_.

## Distribuição

A fonte e o processo de build são públicos: qualquer pessoa pode gerar o PDF com `make`. O documento é fornecido sem garantia, nos termos da licença MIT; cada laboratório permanece o único responsável pela sua própria validação (ISO/IEC 17025:2017 §7.2.2 e §7.11).
