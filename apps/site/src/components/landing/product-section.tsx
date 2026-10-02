import { cn } from "@/lib/utils";

import {
  Avatar,
  Card,
  CardText,
  CardVisual,
  Chip,
  panel,
  SectionHeading,
} from "./surfaces";

const POINTS = [
  {
    nominal: "50 g",
    readings: "50,0001  50,0001  50,0002",
    error: "+0,13 mg",
    u: "0,18 mg",
  },
  {
    nominal: "100 g",
    readings: "100,0002  100,0002  100,0001",
    error: "+0,17 mg",
    u: "0,21 mg",
  },
  {
    nominal: "200 g",
    readings: "200,0002  200,0003  200,0002",
    error: "+0,23 mg",
    u: "0,25 mg",
    active: true,
  },
];

const STATES = ["Rascunho", "Em execução", "Em revisão", "Aprovado"];

export function ProductSection() {
  return (
    <section id="fluxo" className="scroll-mt-20 py-24 md:py-32">
      <div className="mx-auto max-w-[1200px] px-6 md:px-8">
        <SectionHeading
          title="O fluxo de uma calibração."
          body="Leituras, padrões, incerteza, revisão, aprovação e entrega ficam ligados ao mesmo registro, do pedido do cliente ao certificado assinado."
        />

        <div className="mt-12 grid gap-4 md:grid-cols-12">
          <Card className="md:col-span-7">
            <CardVisual>
              <MeasurementTable />
            </CardVisual>
            <CardText
              title="Execução e cálculo no mesmo lugar"
              body="O técnico registra as leituras e vincula os padrões de referência. O motor calcula o orçamento de incerteza conforme o GUM, com k e graus de liberdade explícitos, e grava o resultado com a versão que o produziu."
            />
          </Card>

          <Card className="md:col-span-5">
            <CardVisual>
              <StateTrack />
            </CardVisual>
            <CardText
              title="Revisão e aprovação com papéis distintos"
              body="A aprovação congela a versão, gera o PDF e assina com o certificado ICP-Brasil A1 do laboratório. Uma mudança depois vira retificação, com a versão anterior preservada."
            />
          </Card>

          <Card className="md:col-span-4">
            <CardVisual className="h-[220px]">
              <EntryList />
            </CardVisual>
            <CardText
              title="Entrada por solicitação, visita ou OS"
              body="O cliente pede pelo portal, o laboratório agenda a visita em campo ou abre a ordem de serviço com reparo. Todas criam o mesmo registro."
            />
          </Card>

          <Card className="md:col-span-4">
            <CardVisual className="h-[220px]">
              <StandardCard />
            </CardVisual>
            <CardText
              title="Padrões com validade que bloqueia"
              body="Cada padrão traz certificado, incerteza e validade. Padrão vencido não pode ser vinculado a uma calibração."
            />
          </Card>

          <Card className="md:col-span-4">
            <CardVisual className="h-[220px]">
              <HistoryList />
            </CardVisual>
            <CardText
              title="Histórico de quem fez o quê"
              body="Criação, execução, revisão, aprovação e retificação registradas com autor, data e hora, por calibração, equipamento, padrão e método."
            />
          </Card>
        </div>
      </div>
    </section>
  );
}

/** The measurement table during execution; the frame peeks in from the bottom. */
function MeasurementTable() {
  return (
    <div
      className={cn(
        panel,
        "absolute inset-x-4 top-8 overflow-hidden rounded-b-none border-b-0 sm:inset-x-8",
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="text-[13px] font-medium text-foreground">
          Erro de indicação{" "}
          <span className="font-mono text-[12px] font-normal text-muted-foreground">
            · CAL-2026-0231
          </span>
        </span>
        <Chip tone="info">Em execução</Chip>
      </div>
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="text-left text-[11px] font-medium text-muted-foreground">
            <th className="px-4 py-2 font-medium">Ponto</th>
            <th className="hidden px-4 py-2 font-medium sm:table-cell">
              Leituras (g)
            </th>
            <th className="px-4 py-2 text-right font-medium">Erro</th>
            <th className="px-4 py-2 text-right font-medium">U (k = 2)</th>
          </tr>
        </thead>
        <tbody>
          {POINTS.map((point) => (
            <tr
              key={point.nominal}
              className={cn(
                "border-t border-border",
                point.active && "bg-indigo-50/60 dark:bg-indigo-500/10",
              )}
            >
              <td className="px-4 py-2 font-mono font-medium tabular-nums text-foreground">
                {point.nominal}
              </td>
              <td className="hidden px-4 py-2 font-mono tabular-nums whitespace-pre text-muted-foreground sm:table-cell">
                {point.readings}
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums text-foreground">
                {point.error}
              </td>
              <td
                className={cn(
                  "px-4 py-2 text-right font-mono tabular-nums",
                  point.active
                    ? "font-medium text-indigo-700 dark:text-indigo-300"
                    : "text-foreground",
                )}
              >
                {point.u}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">
        <span>
          Padrão vinculado:{" "}
          <span className="font-mono text-foreground">PAD-014</span> · Jogo de
          pesos E2
        </span>
        <span>
          Critério <span className="font-mono text-foreground">± 1,0 mg</span>
        </span>
      </div>
    </div>
  );
}

/** The calibration's states, with approval as the current one. */
function StateTrack() {
  const current = 3;
  return (
    <div className="absolute inset-x-6 top-1/2 -translate-y-1/2">
      <div className={cn(panel, "p-5")}>
        <ol
          className="relative grid grid-cols-4 gap-2"
          aria-label="Estados da calibração"
        >
          <span
            aria-hidden
            className="absolute top-[7px] right-[12.5%] left-[12.5%] h-0.5 rounded-full bg-border"
          />
          <span
            aria-hidden
            className="absolute top-[7px] left-[12.5%] h-0.5 rounded-full bg-[linear-gradient(90deg,#4f46e5,#1447e6)]"
            style={{ width: `${(current / 3) * 75}%` }}
          />
          {STATES.map((state, index) => {
            const done = index < current;
            const active = index === current;
            return (
              <li
                key={state}
                className="relative flex flex-col items-center gap-2 text-center"
              >
                <span
                  aria-hidden
                  className={cn(
                    "relative z-[1] size-4 rounded-full ring-4 ring-card",
                    active &&
                      "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.18)]",
                    done && "bg-[#4f46e5]",
                    !done &&
                      !active &&
                      "bg-card shadow-[inset_0_0_0_2px_rgba(15,23,42,0.12)]",
                  )}
                />
                <span
                  className={cn(
                    "text-[12px] leading-tight",
                    active
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {state}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4 text-[12.5px]">
          <span className="flex items-center gap-2.5">
            <Avatar initials="CM" />
            <span className="text-foreground">
              Carla Menezes{" "}
              <span className="text-muted-foreground">aprovou</span>
            </span>
          </span>
          <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
            14/08 · 10:42
          </span>
        </div>
      </div>
    </div>
  );
}

const ENTRIES = [
  { kind: "Solicitação", code: "SOL-0187", state: "Convertida", tone: "info" },
  {
    kind: "Visita em campo",
    code: "VIS-0042",
    state: "Confirmada",
    tone: "ok",
  },
  {
    kind: "Ordem de serviço",
    code: "OS-1187",
    state: "Em orçamento",
    tone: "warn",
  },
] as const;

function EntryList() {
  return (
    <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 sm:inset-x-6">
      <ul className={cn(panel, "divide-y divide-border")}>
        {ENTRIES.map((entry) => (
          <li
            key={entry.code}
            className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px]"
          >
            <span className="min-w-0 truncate text-foreground">
              {entry.kind}{" "}
              <span className="font-mono text-[11.5px] text-muted-foreground">
                · {entry.code}
              </span>
            </span>
            <Chip tone={entry.tone}>{entry.state}</Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StandardCard() {
  return (
    <div className="absolute inset-x-6 top-1/2 -translate-y-1/2">
      <div className={cn(panel, "p-4")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-foreground">
              Jogo de pesos E2{" "}
              <span className="font-mono text-[11.5px] font-normal text-muted-foreground">
                · PAD-014
              </span>
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Certificado{" "}
              <span className="font-mono text-foreground">1188/2025</span>
            </p>
          </div>
          <Chip tone="ok">Ativo</Chip>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-[12px]">
          <div>
            <dt className="text-muted-foreground">Incerteza</dt>
            <dd className="font-mono tabular-nums text-foreground">
              0,05 mg (k = 2)
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Válido até</dt>
            <dd className="font-mono tabular-nums text-foreground">
              03/03/2027
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

const EVENTS = [
  { label: "Criado", who: "Rafael Souza", at: "11/08 09:31" },
  { label: "Executado", who: "Rafael Souza", at: "12/08 15:48" },
  { label: "Em revisão", who: "Rafael Souza", at: "12/08 16:20" },
  { label: "Aprovado", who: "Carla Menezes", at: "14/08 10:42", accent: true },
];

function HistoryList() {
  return (
    <div className="absolute inset-x-6 top-1/2 -translate-y-1/2">
      <ol className={cn(panel, "relative px-4 py-2")}>
        <span
          aria-hidden
          className="absolute top-4 bottom-4 left-[23px] w-px bg-border"
        />
        {EVENTS.map((event) => (
          <li
            key={event.label}
            className="relative grid grid-cols-[16px_1fr_auto] items-center gap-3 py-1.5 text-[12px]"
          >
            <span
              aria-hidden
              className={cn(
                "size-2 justify-self-center rounded-full ring-2 ring-card",
                event.accent ? "bg-[#4f46e5]" : "bg-zinc-300 dark:bg-zinc-600",
              )}
            />
            <span className="min-w-0 truncate">
              <span className="font-medium text-foreground">{event.label}</span>{" "}
              <span className="text-muted-foreground">· {event.who}</span>
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {event.at}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
