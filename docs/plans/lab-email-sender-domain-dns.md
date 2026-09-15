# Lab-owned sending domains: DNS and deliverability research

Status: research only, no code changed. Fetch dates below are 2026-09-09 unless stated.
Scope: replaces "lab runs its own Resend account" with "we mint the sending domain under
our Resend account via the Domains API; the lab publishes the DNS records we generate."
Prior art in this repo: `apps/api/src/routes/portal-domains.ts` +
`apps/api/src/lib/portal-domains.ts` (single TXT at `_calibrafacil-domain.<hostname>`,
verified by a Cloudflare DoH lookup). That is the friction bar a real customer already cleared.

## Recommended shape

Sending subdomain: `certificados.<laboratorio>.com.br` (never the apex — see (b)).

Records the lab publishes (Resend's current DKIM CNAME + TXT/MX SPF pair, confirmed against
Resend's own docs/changelog — see (c)):

```
Type   Host                                          Value
CNAME  resend._domainkey.certificados.<lab>.com.br    <selector>.dkim.resend.com   (or 3 randomized CNAMEs on newer domains)
TXT    send.certificados.<lab>.com.br                 "v=spf1 include:amazonses.com ~all"
MX     send.certificados.<lab>.com.br     10          feedback-smtp.<region>.amazonses.com
TXT    _dmarc.certificados.<lab>.com.br               "v=DMARC1; p=none; rua=mailto:dmarc@<lab>.com.br"
```

That's 3-4 records (DKIM CNAME(s) + SPF TXT + MX, DMARC optional but recommended — see (f)
for why we should actually make it non-optional when the apex already has a strict policy).
This is the same record count and record types (CNAME/TXT/MX) as the portal's TXT-only flow,
just three more of them, and delivered through the identical "we show it, they paste it,
we poll DNS" mechanic already built.

**Time estimate for a non-technical lab owner:** 15-30 minutes of active work if the DNS
panel is Registro.br, Cloudflare, or a modern host — creating 3-4 records is mechanically
the same motion as the one TXT record they already did for the portal, repeated a few more
times. Realistic total elapsed time including the person finding their DNS login and waiting
for propagation is 1-24 hours, because:

- They will get stuck on **MX vs CNAME on the same host name** if we advise them to put the
  SPF TXT on the same label as an existing CNAME/MX for that subdomain — DNS forbids other
  record types coexisting with a CNAME at one name (RFC 1034 §3.6.2, confirmed via search
  2026-09-09), so the SPF TXT and MX must sit on `send.<subdomain>`, not on the DKIM CNAME's
  own host label. This is the single most common support ticket for every ESP's DKIM/SPF
  setup and is worth a distinct warning in our UI copy, not just a table.
- They will get stuck if their panel (agency-built sites are common per the brief) doesn't
  support separate records per subdomain label cleanly, or if the "www" website and the mail
  DNS are on different providers than they remember.
- Propagation is typically fast (TTL-bound, often under an hour) but we should not promise
  same-session verification.

## a) True minimum DNS for authenticated sending in 2026

Primary/official sources, not blog aggregates, for the actual numbers:

- **Gmail** (support.google.com/a/answer/81126, fetched 2026-09-09): all senders must set up
  SPF **or** DKIM, valid forward/reverse DNS, TLS, spam rate <0.3% in Postmaster Tools.
  **Bulk senders (≥5,000 msgs/day to gmail.com)** additionally must have SPF **and** DKIM,
  a DMARC record (`p=none` is enough to satisfy the requirement), From: domain aligned with
  SPF or DKIM, one-click unsubscribe (RFC 8058) on marketing/subscribed mail, spam rate
  <0.30%. DKIM key ≥1024 bits (2048 recommended).
- **Yahoo** (senders.yahooinc.com/best-practices/, fetched 2026-09-09): all senders "implement
  SPF or DKIM at a minimum," spam rate <0.3%. Bulk senders: SPF **and** DKIM, DMARC `p=none`+
  passing, relaxed alignment acceptable, one-click unsubscribe (RFC 8058 preferred, mailto
  acceptable), honor unsubscribe within 2 days.
- **Microsoft** (techcommunity.microsoft.com, dmarcian.com summary corroborating it, fetched
  2026-09-09): effective **May 5, 2025**, senders of ≥5,000 msgs/day to outlook.com/
  hotmail.com/live.com must pass SPF, DKIM, and DMARC (`p=none` minimum, aligned to SPF or
  DKIM), or get a hard **550 5.7.515** rejection, not a junk-folder placement.

A calibration lab sending a few hundred certificates a month is **below every one of these
5,000/day bulk thresholds** by orders of magnitude. Strictly, SPF-or-DKIM (not both, no
DMARC) already satisfies the letter of all three providers' minimum requirements. But:

- DMARC alignment (not just SPF-or-DKIM) is what actually suppresses Gmail's "via" annotation
  (see (e)) — the real product requirement here isn't "don't get blocked," it's "look like the
  lab sent it." That needs SPF or DKIM to be _aligned_, i.e. the visible From: domain must
  match the authenticating domain, which for a delegated CNAME/MX setup means DKIM alignment
  (our DKIM `d=` is the lab's subdomain) — SPF alignment alone would require the envelope
  MAIL FROM to also be on the lab's domain, which the MX/TXT return-path pair above provides.
  So doing both, correctly aligned, plus publishing DMARC ourselves is the right target
  regardless of volume, because it's what buys the "no via" outcome the whole feature exists for.

## b) Subdomain vs apex

- **DMARC inheritance** (RFC 7489 §6.6.3 and §6.3, fetched via rfc-editor.org 2026-09-09):
  policy discovery is at most 2 DNS queries — first at the exact From: domain, then (only if
  that's absent) at the Organizational Domain. A subdomain with **no DMARC record of its own**
  inherits the apex's `p=` (or its `sp=` if set — `sp` applies only to subdomains and is
  itself ignored when a subdomain publishes its own record). A subdomain **with its own DMARC
  record** overrides the apex entirely for that subdomain, including `rua`/`ruf`/`pct` unless
  repeated. This means: if we publish `_dmarc.certificados.<lab>.com.br` ourselves (recommended
  above), we are fully independent of whatever the apex's DMARC policy is or becomes later —
  this is the mechanism that makes (f) a non-issue when handled correctly.
- **SPF and DKIM do need their own records on the subdomain.** SPF (RFC 7208) is evaluated at
  whatever domain is in play (From: domain for pseudo-alignment purposes via envelope MAIL
  FROM) — there is no inheritance from parent to child the way DMARC has; the subdomain needs
  its own SPF TXT record (confirmed: SPF has no organizational-domain fallback, unlike DMARC).
  Same for DKIM: the selector is a name directly under the signing domain
  (`selector._domainkey.<d=domain>`), so `certificados.<lab>.com.br` needs its own DKIM
  records regardless of what the apex has.
- **Reputation isolation is real and is the main reason to use a subdomain at all.** Because
  SPF/DKIM/DMARC for a subdomain are independently configured (previous point), and because
  major mailbox providers track sending reputation largely at the authenticated
  domain/subdomain level, `certificados.<lab>.com.br` builds and carries its own reputation
  distinct from `<lab>.com.br`. Concretely this protects both directions asked about: our
  transactional certificate mail can't be dragged down by the lab's separately-run marketing
  or support mail on the apex, and — the more important direction for us — if a lab's apex
  ever gets a poor sender reputation (compromised mailbox, spam), it does not automatically
  contaminate the certificate-delivery subdomain we operate, and vice versa a delivery problem
  on our side doesn't touch their main domain's mail.

## c) CNAME delegation: what it buys, what stays TXT

- **DKIM**: RFC 6376 itself only requires a TXT record at `selector._domainkey.domain`; DNS
  resolution for TXT queries transparently follows a CNAME at that name per RFC 1034 §3.6.2
  (confirmed via search 2026-09-09), which is why ESPs can point the _name_ at a CNAME whose
  _target_ is a TXT record they control. This is a provider convention layered on ordinary DNS
  behavior, not a DKIM-spec requirement. What it buys: **the lab never touches DNS again when
  we rotate the DKIM key** — we change the TXT record under the CNAME target on our side (or
  Resend/SES does), the lab's CNAME still points at the same name. AWS SES's Easy DKIM is the
  clearest documented example: 3 CNAMEs per identity, one active at a time, SES rotates
  automatically roughly every 90 days with zero DNS change on the customer's end (confirmed via
  AWS re:Post community documentation and Pulumi's SES rotation reference, fetched 2026-09-09 —
  I could not get AWS's own docs.aws.amazon.com page to return body text through the fetch
  tool, so treat the exact cadence as secondary-sourced, not primary-quoted). Resend's DKIM
  setup for newly created domains now mirrors this with 3 randomized-selector CNAMEs (Resend
  knowledge base + resend-skills reference repo, fetched 2026-09-09), replacing its older
  single `resend._domainkey` TXT record which required the customer to update the TXT value by
  hand if the key ever rotated.
- **SPF cannot itself be delegated by CNAME at the domain in question** — a name cannot carry
  both a CNAME and a TXT record simultaneously (RFC 1034 §3.6.2, "no other data" rule; confirmed
  via search 2026-09-09), so if the SPF-relevant domain (envelope MAIL FROM / return-path
  domain) also needs an MX record, that name must be a plain TXT+MX pair the lab publishes
  once. What _is_ delegated is the SPF **policy content**, via the `include:` mechanism — the
  lab's TXT says `v=spf1 include:amazonses.com ~all`, so we can change which IPs are authorized
  by editing `amazonses.com`'s own SPF record, not the lab's. So: the record itself (TXT+MX)
  is fixed at the lab's DNS forever; what we can rotate without them is _what's on the other
  end of the include_.
- **Net effect**: DKIM key rotation is fully delegate-able (CNAME), the SPF/MX return-path pair
  is a one-time publish that then never needs to change on the lab's side either (because we
  rotate via `include:`, not by asking them to edit the TXT). Practically, once the 3-4 records
  are live, we should never need to ask the lab to touch DNS again for routine operation.

## d) NS delegation — assessed and rejected as the default, viable as an enterprise option

Technically real: Registro.br and Cloudflare both support delegating a subdomain via NS
records to third-party nameservers (registro.br docs on delegation + Cloudflare's
subdomain-setup docs, fetched 2026-09-09). Cloudflare specifically documents "shadowed
records" (anything left in the parent zone at/below the delegation point is inert) and caps
NS records at 10 per delegation (7 recommended).

What it costs us to operate:

- We'd need to run (or buy, e.g. via Route 53 or Cloudflare as our own authoritative backend)
  redundant, low-latency, correctly-glued nameservers per delegated zone, and automate zone
  creation/teardown per lab — meaningfully more infrastructure than "call the Domains API and
  poll TXT."
- **DNSSEC is the sharp edge.** If the lab's apex zone is DNSSEC-signed (Registro.br signs
  every `.br` registration path and actively promotes DNSSEC — registro.br/tecnologia/dnssec/,
  fetched 2026-09-09, though I could not pull adoption-percentage figures from that page
  through the fetch tool and don't have a solid primary number for how many `.br` domains are
  actually signed-and-validating in practice), a clean NS delegation additionally requires a
  correctly published **DS record in the parent zone** pointing at our delegated zone's key
  (RFC-level DNSSEC chain-of-trust behavior, confirmed via AWS's own DNSSEC subdomain-delegation
  doc and Cloudflare's DNSSEC explainer, fetched 2026-09-09). A non-technical lab whose
  registrar panel doesn't surface "add a DS record for this NS delegation" cleanly — which
  describes most Brazilian reseller/agency panels — will either fail to add it (subdomain
  simply doesn't resolve under validating resolvers, a confusing SERVFAIL with no visible DNS
  error) or the registrar won't offer the control at all for an internal subdomain (DS records
  for `.br` itself are handled by Registro.br at the domain level; DS for an internal
  delegation is a parent-zone TXT-adjacent record the lab's _DNS host_, not the registry, must
  support — inconsistent across providers).
- **Failure mode when the lab changes DNS provider**: the NS delegation record lives in the
  _parent_ zone. When a lab migrates its main domain to a new host (which the brief already
  flags as a real, recurring event for this buyer profile — "web agency who built their site
  years ago"), the new provider's default zone import will not know to recreate a bespoke NS
  delegation for `certificados`. Unlike our current TXT-verification flow, where a dropped
  record degrades to a clearly-surfaced "not verified" status, a dropped NS delegation makes
  the whole subdomain vanish from DNS — silent to the lab (their main site is unaffected), and
  it takes out certificate delivery entirely until someone notices and re-delegates.

Verdict: real, but it converts a one-time DNS chore into a permanent operational dependency
with a DNSSEC failure mode most of this buyer segment cannot self-diagnose, and a migration
failure mode that is silent and total rather than degrading. Worth offering as an _opt-in_
path for the rare technically-sophisticated lab (or one we onboard white-glove) but wrong as
the default flow — the CNAME/TXT/MX shape in the recommendation section gets ~95% of the
delegation benefit (rotate DKIM freely, rotate SPF's authorized senders freely) with none of
the DNSSEC/migration fragility.

## e) The "via" annotation

Confirmed against Google's own help article (support.google.com/mail/answer/1311182, fetched
2026-09-09): Gmail shows "via <domain>" next to the sender name specifically when **the
sending domain differs from the From: address domain** — i.e., no aligned pass. Google's own
remediation instructions are exactly DMARC alignment: publish SPF covering the sending IPs,
"sign messages with a DKIM signature that is associated with the sender's domain," and "make
sure the domain in the From: address matches the domain you're using to authenticate." That
is DKIM `d=` alignment (or SPF envelope-domain alignment) to the visible From:, which is
precisely what DMARC alignment formalizes (RFC 7489 §3.1, relaxed mode = Organizational Domain
match, confirmed via rfc-editor.org fetch 2026-09-09). Concretely for us: if we send with
`From: certificados@certificados.<lab>.com.br` and DKIM-sign with `d=certificados.<lab>.com.br`
(the CNAME'd key from (c)), that's aligned and "via" does not show, regardless of what our own
sending infrastructure domain is underneath. Return-Path/envelope-from also needs to be on a
`<lab>.com.br` subdomain for SPF alignment as a second, independent path to the same aligned
result — which the MX/TXT return-path pair in the recommended records exists to provide.
I could not find an equivalent official Microsoft document describing Outlook.com's own
"via"/"on behalf of" display trigger with the same precision as Google's page — secondary
sources describe the same DMARC-alignment logic but I'm not citing a Microsoft primary source
for it. Treat the Outlook behavior as very likely the same alignment-driven mechanism, not
independently confirmed.

## f) Lab with a strict DMARC policy already on its apex

Per (b), nothing breaks automatically: DMARC policy discovery only escalates to the
Organizational Domain when the exact subdomain has no DMARC record of its own (RFC 7489
§6.6.3). So if the lab's apex publishes `p=reject` and we publish our own
`_dmarc.certificados.<lab>.com.br` (as recommended), our subdomain's policy is authoritative
for itself — a strict apex policy has zero effect on the subdomain's evaluation. **What breaks
is only the failure case we should design against**: if we _don't_ publish a DMARC record on
the subdomain, mail from `certificados.<lab>.com.br` falls through to the apex's `p=reject`
(or its `sp=` if narrower), and any authentication gap on our side gets treated as
apex-level-strict — quarantined or rejected outright, with reports (if `rua` is configured)
landing in the lab's inbox, not ours. Action item, not just observation: our provisioning flow
must **always** write the subdomain's own DMARC TXT record as part of the required set (already
reflected in the recommended records above) — it should never be optional, specifically because
we cannot control or even always know whether a given lab's apex already runs a strict policy.

## g) Do-nothing fallback: send from our domain, lab's display name, Reply-To lab

What the recipient actually sees:

- **Gmail**: From: shows "Nome do Laboratório" as the display name, `<algo>@calibrafacil.com`
  as the address on hover/expand, and — per (e) — no "via" annotation at all, because
  `calibrafacil.com` is both the visible domain and the aligned DKIM/SPF domain; there's no
  mismatch to flag. Reply-To pointed at the lab's real address means a reply goes to the lab
  without ever appearing "via" anything. This is functionally identical to how most SaaS
  transactional mail already looks (Stripe, Notion, etc., all send "Nome da Empresa via
  <product>.com" is specifically what they avoid by _not_ trying to fake a via-free domain).
- **Outlook/Microsoft**: same mechanism — no cross-domain mismatch, so no equivalent
  third-party annotation.
- This is a **defensible default**, not a degraded one: it costs zero DNS setup, it's
  immediately deliverable at full authentication strength (we already pass every requirement in
  (a) on our own verified domain), and the only thing the recipient loses versus a fully
  lab-owned domain is that a technically curious recipient who expands the sender address sees
  `@calibrafacil.com` instead of `@certificados.<lab>.com.br`. For a regulated document
  (calibration certificate) delivered to a business contact who is not scrutinizing SMTP
  headers, display name + Reply-To is very likely sufficient for the trust signal that matters
  ("this came from my lab"), and it sidesteps every failure mode in (a)-(f) entirely.

## Ranked fallbacks for labs that cannot/will not touch DNS

1. **Do-nothing fallback (g)** — our domain, lab's display name, lab's Reply-To. Zero setup,
   zero DNS risk, immediately compliant with every 2026 sender requirement in (a). Should be
   the actual default for every lab on day one, with the DNS-delegated subdomain as an
   upgrade path, not the initial gate.
2. **CNAME/TXT/MX subdomain (the recommended shape above)** — for labs willing to spend the
   ~15-30 minutes, offered as an explicit upsell/setup step, reusing the exact TXT-publish-and-
   poll UX already proven by `portal-domains.ts`.
3. **NS delegation (d)** — offered only for labs we're willing to hand-hold (or who have an
   in-house IT contact), given the DNSSEC and provider-migration failure modes; not
   self-service.
4. **Lab keeps running its own Resend account** (today's model) — strictly worse than (1) for
   any lab that won't do DNS, since it requires the same DNS work as (2) but without us
   controlling rotation/monitoring; only rationale to keep it would be a lab that already has
   deliverability infrastructure and explicitly wants to own it. Not recommended as a fallback
   going forward — (1) dominates it for the non-technical segment this brief is about.

## What I could not verify

- Exact current AWS SES Easy DKIM rotation cadence ("~90 days") and the precise 3-CNAME
  mechanics — I could not get `docs.aws.amazon.com/ses/latest/dg/easy-dkim.html` to return
  body content through the fetch tool (it kept returning only the page title). Corroborated
  instead via AWS's own re:Post community and a Pulumi reference; treat as secondary-sourced.
- A Microsoft-authored primary source for Outlook.com/Outlook.com web's own "via"/"on behalf
  of" sender annotation and its precise trigger condition, equivalent in specificity to
  Google's support.google.com/mail/answer/1311182. Only secondary sources found.
- Any hard number for what fraction of `.br` domains are actually DNSSEC-signed today (a
  Registro.br page exists on the topic but returned no extractable body text via the fetch
  tool); the qualitative DNSSEC-chain-of-trust risk in (d) is RFC-grounded and confirmed, the
  prevalence among this buyer segment's domains is not.
- Resend's exact current (September 2026) Domains API JSON response shape and full DNS-record
  count for a brand-new domain — confirmed the record _types_ (DKIM CNAME(s), SPF TXT, MX)
  from Resend's knowledge base and their public `resend-skills` reference repo, but did not
  get a verbatim API response example.
