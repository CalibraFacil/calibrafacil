import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import { track } from '@/features/analytics/track'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'

import {
  emptyLeadForm,
  parseLeadForm,
  type LeadFormData,
  type LeadFormField,
} from '../lead-form'
import { SectionHeading } from './landing-primitives'

const DEMO_URL = 'https://cal.com/calibrafacil/30min?user=calibrafacil'

function captureAttribution() {
  if (typeof window === 'undefined') {
    return {
      utmSource: '',
      utmMedium: '',
      utmCampaign: '',
      utmTerm: '',
      utmContent: '',
      referrer: '',
    }
  }

  const params = new URLSearchParams(window.location.search)
  return {
    utmSource: params.get('utm_source') ?? '',
    utmMedium: params.get('utm_medium') ?? '',
    utmCampaign: params.get('utm_campaign') ?? '',
    utmTerm: params.get('utm_term') ?? '',
    utmContent: params.get('utm_content') ?? '',
    referrer: document.referrer,
  }
}

export function LeadFormSection() {
  const [form, setForm] = useState<LeadFormData>(emptyLeadForm)
  const [errors, setErrors] = useState<Partial<Record<LeadFormField, string>>>(
    {},
  )
  // Honeypot: hidden from real users; bots fill it and the API discards them.
  const [website, setWebsite] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const mutation = useMutation({
    mutationFn: (data: LeadFormData) => {
      const parsed = parseLeadForm(data)
      if (!parsed.success) {
        return Promise.reject(parsed)
      }

      return calibraApi.publicLeads.create<{ ok: boolean }>({
        ...parsed.data,
        ...captureAttribution(),
        website,
      })
    },
    onSuccess: () => {
      track('lead_submit', { segment: form.segment || 'outro' })
      setSubmitted(true)
    },
    onError: (error: unknown) => {
      if (
        error &&
        typeof error === 'object' &&
        'fieldErrors' in error &&
        Array.isArray(error.fieldErrors)
      ) {
        const parsed = error.fieldErrors
        setErrors(
          Object.fromEntries(
            parsed.map((item: { field: LeadFormField; message: string }) => [
              item.field,
              item.message,
            ]),
          ),
        )
        toast.error('Confira os campos destacados.')
        return
      }

      toast.error('Não foi possível enviar. Tente novamente ou use o WhatsApp.')
    },
  })

  function updateField<TKey extends LeadFormField>(
    field: TKey,
    value: LeadFormData[TKey],
  ) {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErrors({})
    mutation.mutate(form)
  }

  return (
    <section id="contato" className="border-t border-border/70 py-24">
      <div className="mx-auto max-w-[720px] px-6 md:px-8">
        <SectionHeading
          center
          title="Fale com um especialista"
          lead="Conte um pouco sobre o seu laboratório ou oficina. Retornamos com uma proposta e uma demonstração focada no seu escopo."
        />

        {submitted ? (
          <div className="mx-auto mt-10 max-w-[520px] rounded-2xl border border-border bg-card px-6 py-10 text-center">
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
                    track('demo_click', { location: 'lead_success' })
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
            className="mt-10 rounded-2xl border border-border bg-card px-6 py-8 sm:px-8"
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="lead-name">Nome *</FieldLabel>
                <Input
                  id="lead-name"
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  autoComplete="name"
                  aria-invalid={Boolean(errors.name)}
                />
                {errors.name ? (
                  <FieldError id="lead-name-error">{errors.name}</FieldError>
                ) : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="lead-email">E-mail *</FieldLabel>
                <Input
                  id="lead-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  autoComplete="email"
                  aria-invalid={Boolean(errors.email)}
                />
                {errors.email ? (
                  <FieldError id="lead-email-error">{errors.email}</FieldError>
                ) : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="lead-phone">
                  Telefone / WhatsApp
                </FieldLabel>
                <Input
                  id="lead-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  autoComplete="tel"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="lead-company">Empresa</FieldLabel>
                <Input
                  id="lead-company"
                  value={form.company}
                  onChange={(e) => updateField('company', e.target.value)}
                  autoComplete="organization"
                />
              </Field>

              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="lead-segment">Perfil</FieldLabel>
                <NativeSelect
                  id="lead-segment"
                  value={form.segment}
                  onChange={(e) => updateField('segment', e.target.value)}
                >
                  <NativeSelectOption value="">Selecione…</NativeSelectOption>
                  <NativeSelectOption value="lab">
                    Laboratório de calibração
                  </NativeSelectOption>
                  <NativeSelectOption value="oficina">
                    Oficina permissionária do Inmetro
                  </NativeSelectOption>
                  <NativeSelectOption value="outro">Outro</NativeSelectOption>
                </NativeSelect>
              </Field>

              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="lead-message">Mensagem</FieldLabel>
                <Textarea
                  id="lead-message"
                  value={form.message}
                  onChange={(e) => updateField('message', e.target.value)}
                  rows={4}
                  placeholder="Grandezas que você calibra, volume mensal, dúvidas…"
                />
                <FieldDescription>
                  Seus dados são usados apenas para este contato comercial.
                </FieldDescription>
              </Field>
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

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button type="submit" size="lg" disabled={mutation.isPending}>
                {mutation.isPending ? 'Enviando…' : 'Falar com um especialista'}
                <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
              </Button>
              <a
                href={DEMO_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('demo_click', { location: 'lead_form' })}
                className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
              >
                ou agende uma demonstração
              </a>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
