import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  BrowserIcon,
  CalculatorIcon,
  DatabaseIcon,
  LaptopIcon,
  ServerStack01Icon,
  SignatureIcon,
  UserGroupIcon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";

import { REPOSITORY_URL } from "@/lib/site";

import { SectionHeading } from "./surfaces";

// The workspaces a first contribution usually touches, each linked to its
// folder on GitHub. The README carries the full map.
const WORKSPACES: {
  icon: IconSvgElement;
  path: string;
  title: string;
  body: string;
}[] = [
  {
    icon: BrowserIcon,
    path: "apps/web",
    title: "Sistema do laboratório",
    body: "React 19, Vite, TanStack Router e Query, Tailwind 4. O mesmo código roda no navegador e no aplicativo desktop.",
  },
  {
    icon: UserGroupIcon,
    path: "apps/portal",
    title: "Portal do cliente",
    body: "Aplicativo próprio, com domínio personalizado e a identidade visual do laboratório.",
  },
  {
    icon: ServerStack01Icon,
    path: "apps/api",
    title: "API",
    body: "Hono sobre Bun, Better Auth com acesso sem senha e PostgreSQL via Drizzle.",
  },
  {
    icon: WorkflowSquare01Icon,
    path: "apps/worker",
    title: "Worker",
    body: "Gera e assina os PDFs, envia os e-mails e roda as sincronizações em segundo plano.",
  },
  {
    icon: LaptopIcon,
    path: "apps/desktop",
    title: "Aplicativo desktop",
    body: "Electron com servidor local em SQLite, fila de saída e resolução de conflitos para trabalhar offline.",
  },
  {
    icon: CalculatorIcon,
    path: "packages/math-engine",
    title: "Motor de incerteza",
    body: "Aritmética decimal exata, avaliação dos tipos A e B, Welch–Satterthwaite e dossiês de validação por versão.",
  },
  {
    icon: SignatureIcon,
    path: "packages/signing",
    title: "Assinatura digital",
    body: "PAdES com certificado ICP-Brasil A1, carimbo de tempo e verificação de cadeia e revogação.",
  },
  {
    icon: DatabaseIcon,
    path: "packages/db",
    title: "Banco de dados",
    body: "Schema Drizzle, migrações em SQL puro e o laboratório de demonstração usado no desenvolvimento.",
  },
];

export function ArchitectureSection() {
  return (
    <section
      id="arquitetura"
      className="scroll-mt-20 border-t border-border py-24 md:py-32"
    >
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">
        <SectionHeading
          title="Um monorepo em TypeScript, de ponta a ponta."
          body="Três interfaces, uma API e um worker sobre pacotes compartilhados. As regras de arquitetura são verificadas pelo lint e documentadas no repositório."
        />

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {WORKSPACES.map((workspace) => (
            <a
              key={workspace.path}
              href={`${REPOSITORY_URL}/tree/main/${workspace.path}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl border border-border bg-card p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-foreground/20"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                  <HugeiconsIcon
                    icon={workspace.icon}
                    className="size-[18px]"
                    strokeWidth={1.75}
                  />
                </span>
                <code className="font-mono text-[12px] text-muted-foreground transition-colors group-hover:text-foreground">
                  {workspace.path}
                </code>
              </div>
              <h3 className="mt-4 text-[16px] font-semibold tracking-[-0.01em] text-foreground">
                {workspace.title}
              </h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
                {workspace.body}
              </p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
