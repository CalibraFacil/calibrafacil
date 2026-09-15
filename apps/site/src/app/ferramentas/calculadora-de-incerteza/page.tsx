import type { Metadata } from "next";
import Link from "next/link";

import { UncertaintyCalculator } from "@/components/tools/uncertainty-calculator";
import { absoluteUrl, CONTACT_URL, DEMO_URL, SITE_NAME } from "@/lib/site";

const TITLE = "Calculadora de incerteza de medição (GUM)";
const DESCRIPTION =
  "Calculadora gratuita de incerteza de medição conforme o GUM (JCGM 100:2008): contribuições Tipo A e Tipo B, composição quadrática, graus de liberdade efetivos por Welch-Satterthwaite e incerteza expandida U = k · uc.";

const URL = absoluteUrl("/ferramentas/calculadora-de-incerteza");

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: { title: TITLE, description: DESCRIPTION, url: URL },
};

const FAQ = [
  {
    q: "O que é incerteza de medição?",
    a: "É o parâmetro que caracteriza a dispersão dos valores que podem ser razoavelmente atribuídos ao mensurando. Nenhuma medição entrega um valor único: entrega um valor e um intervalo dentro do qual o valor verdadeiro provavelmente está. A ISO/IEC 17025:2017, no item 7.6, exige que o laboratório avalie a incerteza de medição de cada calibração que realiza.",
  },
  {
    q: "Qual a diferença entre incerteza Tipo A e Tipo B?",
    a: "A diferença é o método de avaliação, não a natureza da grandeza. Tipo A é avaliada por análise estatística de observações repetidas — o desvio-padrão da média de uma série de leituras. Tipo B é avaliada por qualquer outro meio: certificado de um padrão, especificação do fabricante, resolução do instrumento, dados de deriva, experiência documentada. Ambas produzem uma incerteza-padrão e entram no orçamento do mesmo jeito.",
  },
  {
    q: "Por que a distribuição retangular divide por raiz de 3?",
    a: "Quando só se conhecem os limites de um intervalo e não há razão para acreditar que algum valor interno seja mais provável que outro, a distribuição é retangular (uniforme). O desvio-padrão de uma distribuição uniforme de meia-largura a é a/√3. Pelo mesmo raciocínio, a triangular — que no GUM é o caso particular da trapezoidal — divide por √6. A distribuição em U (arco-seno), usada para grandezas cíclicas, divide por √2; ela é prática consagrada em guias derivados, não uma cláusula do GUM.",
  },
  {
    q: "O que é o coeficiente de sensibilidade?",
    a: "É a derivada parcial do modelo de medição em relação àquela grandeza de entrada: quanto o resultado muda quando a entrada varia de uma unidade. Ele converte a incerteza da entrada para a unidade do resultado. Quando a grandeza entra diretamente no resultado, e na mesma unidade, o coeficiente é 1 — que é o caso da maioria das linhas de um orçamento simples.",
  },
  {
    q: "O que é o fator de abrangência k?",
    a: "É o multiplicador que transforma a incerteza-padrão combinada em incerteza expandida: U = k · uc. Ele vem da distribuição t de Student avaliada nos graus de liberdade efetivos, para a probabilidade de abrangência desejada. Para graus de liberdade infinitos e 95,45 %, k vale 2,0000 — que é a origem da convenção de usar k = 2 nos certificados.",
  },
  {
    q: "Como se calculam os graus de liberdade efetivos?",
    a: "Pela equação de Welch-Satterthwaite (GUM, eq. G.2b): ν_eff = uc⁴ dividido pela soma de ui⁴/νi de cada contribuição. Contribuições Tipo B tratadas como confiáveis têm graus de liberdade infinitos e desaparecem do denominador. Quanto menos observações tiver a componente Tipo A dominante, menores os graus de liberdade efetivos e maior o k.",
  },
  {
    q: "Com quantos algarismos significativos devo declarar a incerteza?",
    a: "A prática consagrada, descrita no item 7.2.6 do GUM, é declarar a incerteza com dois algarismos significativos e arredondar o resultado da medição na mesma casa decimal. Esta calculadora exibe dois algarismos significativos, mas não arredonda os valores internos: o arredondamento é só de apresentação.",
  },
  {
    q: "Posso usar esta calculadora para emitir um certificado acreditado?",
    a: "A calculadora reproduz a matemática do GUM e é útil para conferir uma planilha ou estudar um orçamento, mas um certificado acreditado exige mais do que o número: exige o modelo de medição declarado, rastreabilidade do padrão utilizado, validade da calibração desse padrão, registro de quem executou e revisou, e trilha de auditoria da emissão. É isso que o CalibraFácil faz em torno do mesmo cálculo.",
  },
];

const STEPS = [
  {
    title: "1. Avaliar cada contribuição",
    body: "Cada fonte de incerteza vira uma incerteza-padrão u(xi). Tipo A sai do desvio-padrão da média das observações, s/√n. Tipo B sai da meia-largura dividida pelo divisor da distribuição, ou de U/k quando a fonte é o certificado de um padrão.",
  },
  {
    title: "2. Converter para a unidade do resultado",
    body: "Cada u(xi) é multiplicada pelo coeficiente de sensibilidade ci, produzindo a contribuição ui(y) na unidade do mensurando.",
  },
  {
    title: "3. Compor quadraticamente",
    body: "A incerteza-padrão combinada é a raiz da soma dos quadrados das contribuições — a lei de propagação de incertezas do GUM para grandezas de entrada não correlacionadas.",
  },
  {
    title: "4. Calcular os graus de liberdade efetivos",
    body: "Welch-Satterthwaite pondera os graus de liberdade de cada componente pela sua participação na variância combinada. Componentes com poucas observações puxam ν_eff para baixo.",
  },
  {
    title: "5. Expandir",
    body: "k é o quantil t de Student em ν_eff para a probabilidade escolhida, e U = k · uc é a incerteza expandida que vai para o certificado.",
  },
];

export default function UncertaintyCalculatorPage() {
  return (
    <article className="mx-auto max-w-4xl px-6 py-16 md:py-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            {
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: TITLE,
              url: URL,
              applicationCategory: "EngineeringApplication",
              operatingSystem: "Web",
              inLanguage: "pt-BR",
              description: DESCRIPTION,
              isAccessibleForFree: true,
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "BRL",
              },
              publisher: { "@type": "Organization", name: SITE_NAME },
            },
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: FAQ.map((item) => ({
                "@type": "Question",
                name: item.q,
                acceptedAnswer: { "@type": "Answer", text: item.a },
              })),
            },
          ]),
        }}
      />

      <nav className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
        <Link
          href="/ferramentas"
          className="transition-colors hover:text-foreground"
        >
          Ferramentas
        </Link>
        <span className="mx-2 text-border">/</span>
        <span className="text-foreground/70">Incerteza (GUM)</span>
      </nav>

      <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.08]">
        Calculadora de incerteza de medição
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-pretty text-muted-foreground">
        Monte um orçamento de incerteza conforme o GUM (JCGM 100:2008):
        contribuições Tipo A e Tipo B, composição quadrática, graus de liberdade
        efetivos por Welch-Satterthwaite e incerteza expandida. Gratuita, sem
        cadastro, e o cálculo roda no seu navegador — nada do que você digitar
        sai desta página.
      </p>
      <p className="mt-4 text-[15px] leading-relaxed text-pretty text-muted-foreground">
        O exemplo carregado é um orçamento de pesagem. Troque os valores pelos
        do seu laboratório.
      </p>

      <UncertaintyCalculator />

      <section className="mt-16 border-t border-border pt-10">
        <h2 className="font-mono text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Como o cálculo é feito
        </h2>
        <dl className="mt-6 grid gap-6">
          {STEPS.map((step) => (
            <div key={step.title}>
              <dt className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                {step.title}
              </dt>
              <dd className="mt-1.5 text-[15px] leading-relaxed text-pretty text-muted-foreground">
                {step.body}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-[15px] leading-relaxed text-pretty text-muted-foreground">
          A calculadora assume grandezas de entrada não correlacionadas. Quando
          duas contribuições compartilham uma origem — o mesmo padrão, o mesmo
          termômetro, a mesma leitura — existe correlação, e tratá-la como nula
          subestima a incerteza expandida. Esse é o único erro que um
          certificado de calibração não pode cometer, e é por isso que a
          correlação está fora da ferramenta pública em vez de aparecer nela
          silenciosamente zerada.
        </p>
      </section>

      <section className="mt-14 rounded-xl border border-border bg-card p-7">
        <h2 className="text-xl font-semibold tracking-[-0.01em] text-foreground text-balance">
          Este cálculo é o mesmo que emite o certificado
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-pretty text-muted-foreground">
          Os números acima vêm do motor de cálculo do CalibraFácil, o mesmo que
          compõe o orçamento de incerteza impresso em cada certificado emitido
          pelo sistema. A diferença é o que existe em volta dele: método
          versionado, padrão rastreável com validade verificada, revisão e
          aprovação por papéis distintos, trilha de auditoria e assinatura em
          ICP-Brasil.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href={CONTACT_URL}
            className="inline-flex items-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Falar com um especialista
          </a>
          <a
            href={DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Agendar demonstração
          </a>
        </div>
      </section>

      <section className="mt-14 border-t border-border pt-10">
        <h2 className="font-mono text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Perguntas frequentes
        </h2>
        <dl className="mt-6 grid gap-7">
          {FAQ.map((item) => (
            <div key={item.q}>
              <dt className="text-[15px] font-semibold tracking-[-0.01em] text-foreground text-balance">
                {item.q}
              </dt>
              <dd className="mt-1.5 text-[15px] leading-relaxed text-pretty text-muted-foreground">
                {item.a}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-14 border-t border-border pt-10">
        <h2 className="font-mono text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Continuar
        </h2>
        <ul className="mt-5 grid gap-2.5">
          {[
            {
              label: "Como montar um orçamento de incerteza (GUM)",
              href: "/blog/posts/orcamento-de-incerteza-de-medicao-gum",
            },
            {
              label: "Cálculo de incerteza no CalibraFácil",
              href: "/recursos/calculo-de-incerteza-gum",
            },
            {
              label: "Certificados conforme a ISO/IEC 17025",
              href: "/recursos/certificados-iso-17025",
            },
            {
              label: "Calibração de balança (massa)",
              href: "/calibracao/balanca",
            },
            {
              label: "Laboratórios acreditados pela Cgcre",
              href: "/solucoes/laboratorios-acreditados-cgcre",
            },
          ].map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="text-[15px] text-primary underline-offset-4 hover:underline"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
