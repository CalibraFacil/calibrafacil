# Tipografia do certificado — o que o Chromium do Gotenberg tem

**Medido, não suposto.** Uma página de teste com 17 famílias candidatas foi renderizada pelo
serviço Gotenberg real (`/forms/chromium/convert/html`) e o PDF inspecionado com `pdffonts`.

## Resultado

Presentes e **embutidas + subsetadas automaticamente** no PDF:

| Família | Métrica compatível com | Uso proposto |
| --- | --- | --- |
| **Liberation Serif** (regular · **bold** · *italic*) | Times New Roman | Título display em caixa-alta, e o corpo se quisermos serifada |
| **Liberation Sans** (regular · **bold**) | Arial | Rótulos, cabeçalhos de seção — e satisfaz a NIE-Cgcre-009 A.6.2, que exige Arial no símbolo |
| **Liberation Mono** | Courier New | Numéricos tabulares nas tabelas de resultado |
| DejaVu Serif / Sans / Sans Mono | — | alternativas |
| Carlito | Calibri | (não usar antes do Arial no selo — A.6.2) |
| Caladea | Cambria | alternativa serifada |
| Noto Serif / Noto Sans | — | alternativas |

Os apelidos resolvem: `Times New Roman` → Liberation Serif, `Arial` → Liberation Sans,
`Courier New` → Liberation Mono. Então declarar `Arial, "Liberation Sans", …` funciona nos dois
ambientes — navegador do operador e Chromium do Gotenberg.

## Decisão

**Não embutir fonte nenhuma.** O certificado usa Liberation Serif / Sans / Mono.

- Dá o visual documental que o levantamento pede (UKAS Fig. 1 usa serifada no título), sem
  binário novo no repositório.
- Mata o approach da PR #587, que carregava TTFs em base64 de
  `apps/cms/src/app/(frontend)/og/_fonts` **e de um caminho versionado do store do pnpm**
  (`node_modules/.pnpm/@fontsource-variable+geist-mono@5.2.8/...`) — frágil por construção, e a
  própria PR admitia "bump the pinned version dirs if the lockfile moves".
- Liberation são clones métricos de Times/Arial/Courier: algarismos tabulares por construção,
  que é o que a coluna de resultado precisa.

## Como refazer a medição

```bash
set -a; . apps/api/.env; set +a
curl -sS -X POST "$GOTENBERG_URL/forms/chromium/convert/html" \
  -H "X-Gotenberg-Token: $GOTENBERG_TOKEN" \
  -F "files=@probe.html;filename=index.html" -F "preferCssPageSize=true" \
  -o probe.pdf
pdffonts probe.pdf
```

Vale repetir se a imagem do `services/gotenberg` mudar — o Dockerfile hoje segue
`gotenberg/gotenberg:8` sem pin de patch, então o conjunto de fontes pode mudar sem aviso.
