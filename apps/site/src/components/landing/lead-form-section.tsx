"use client";

import { useState, type FormEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/track";
import { cn } from "@/lib/utils";
import {
  emptyLeadForm,
  parseLeadForm,
  LEADS_ENDPOINT,
  type LeadFormData,
  type LeadFormField,
} from "@/lib/lead-form";

import { SectionHeading } from "./surfaces";

const DEMO_URL = "https://cal.com/calibrafacil/30min?user=calibrafacil";

const controlClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20";

function captureAttribution() {
  if (typeof window === "undefined") {
    return {
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
      utmTerm: "",
      utmContent: "",
      referrer: "",
    };
  }

  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: params.get("utm_source") ?? "",
    utmMedium: params.get("utm_medium") ?? "",
    utmCampaign: params.get("utm_campaign") ?? "",
    utmTerm: params.get("utm_term") ?? "",
    utmContent: params.get("utm_content") ?? "",
    referrer: document.referrer,
  };
}

export function LeadFormSection() {
  const [form, setForm] = useState<LeadFormData>(emptyLeadForm);
  const [errors, setErrors] = useState<Partial<Record<LeadFormField, string>>>(
    {},
  );
  // Honeypot: hidden from real users; bots fill it and the API discards them.
  const [website, setWebsite] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function updateField<TKey extends LeadFormField>(
    field: TKey,
    value: LeadFormData[TKey],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFormError(null);

    const parsed = parseLeadForm(form);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.fieldErrors.map((item) => [item.field, item.message]),
        ),
      );
      setFormError("Confira os campos destacados.");
      return;
    }

    setPending(true);
    try {
      const response = await fetch(LEADS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...parsed.data,
          ...captureAttribution(),
          website,
        }),
      });
      if (!response.ok) throw new Error("request failed");
      track("lead_submit", { segment: form.segment || "outro" });
      setSubmitted(true);
    } catch {
      setFormError(
        "Não foi possível enviar. Tente novamente ou fale pelo WhatsApp.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      id="contato"
      className="scroll-mt-20 border-t border-border bg-[linear-gradient(180deg,var(--muted)_0%,var(--background)_100%)] py-24 md:py-32"
    >
      <div className="mx-auto max-w-[720px] px-6 md:px-8">
        <SectionHeading
          center
          title="Conte como é o seu laboratório."
          body="Quais grandezas calibra, quantas calibrações por mês, se é acreditado ou está implantando a norma. A demonstração é sobre a sua operação."
        />

        {submitted ? (
          <div className="mx-auto mt-10 max-w-[520px] rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-20px_rgba(15,23,42,0.18)]">
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="mx-auto size-10 text-emerald-500"
            />
            <h3 className="mt-4 text-lg font-semibold tracking-tight">
              Contato recebido.
            </h3>
            <p className="mx-auto mt-2 max-w-[42ch] text-sm leading-relaxed text-muted-foreground">
              Nossa equipe responde em breve pelo e-mail informado. Se preferir
              adiantar, agende uma demonstração de 30 minutos.
            </p>
            <Button
              variant="outline"
              size="lg"
              className="mt-6"
              render={
                <a
                  href={DEMO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    track("demo_click", { location: "lead_success" })
                  }
                />
              }
            >
              Agendar demonstração
              <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
            </Button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            noValidate
            className="mt-10 rounded-2xl border border-border bg-card px-6 py-8 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-20px_rgba(15,23,42,0.18)] sm:px-8"
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="lead-name" className="text-sm font-medium">
                  Nome *
                </label>
                <input
                  id="lead-name"
                  className={controlClass}
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  autoComplete="name"
                  aria-invalid={Boolean(errors.name)}
                />
                {errors.name ? (
                  <span className="text-xs text-destructive">
                    {errors.name}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="lead-email" className="text-sm font-medium">
                  E-mail *
                </label>
                <input
                  id="lead-email"
                  type="email"
                  className={controlClass}
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  autoComplete="email"
                  aria-invalid={Boolean(errors.email)}
                />
                {errors.email ? (
                  <span className="text-xs text-destructive">
                    {errors.email}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="lead-phone" className="text-sm font-medium">
                  Telefone / WhatsApp
                </label>
                <input
                  id="lead-phone"
                  type="tel"
                  className={controlClass}
                  value={form.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  autoComplete="tel"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="lead-company" className="text-sm font-medium">
                  Empresa
                </label>
                <input
                  id="lead-company"
                  className={controlClass}
                  value={form.company}
                  onChange={(e) => updateField("company", e.target.value)}
                  autoComplete="organization"
                />
              </div>

              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor="lead-segment" className="text-sm font-medium">
                  Perfil
                </label>
                <select
                  id="lead-segment"
                  className={cn(controlClass, "h-[38px]")}
                  value={form.segment}
                  onChange={(e) => updateField("segment", e.target.value)}
                >
                  <option value="">Selecionar</option>
                  <option value="lab">Laboratório de calibração</option>
                  <option value="oficina">
                    Oficina permissionária do Inmetro
                  </option>
                  <option value="outro">Outro</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor="lead-message" className="text-sm font-medium">
                  Mensagem
                </label>
                <textarea
                  id="lead-message"
                  className={cn(controlClass, "min-h-24")}
                  value={form.message}
                  onChange={(e) => updateField("message", e.target.value)}
                  rows={4}
                  placeholder="Grandezas que calibra, volume mensal, acreditação, dúvidas"
                />
                <span className="text-xs text-muted-foreground">
                  Seus dados são usados apenas para este contato comercial.
                </span>
              </div>
            </div>

            {/* Honeypot — hidden from users, catches bots. */}
            <div aria-hidden className="hidden">
              <label htmlFor="lead-website">Não preencha este campo</label>
              <input
                id="lead-website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>

            {formError ? (
              <p className="mt-5 text-sm text-destructive">{formError}</p>
            ) : null}

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button type="submit" size="lg" disabled={pending}>
                {pending ? "Enviando" : "Enviar e conversar"}
                <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
              </Button>
              <a
                href={DEMO_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track("demo_click", { location: "lead_form" })}
                className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
              >
                ou agende uma demonstração
              </a>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
