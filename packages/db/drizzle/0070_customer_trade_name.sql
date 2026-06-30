-- Add `trade_name` (Nome Fantasia) to `customer`.
--
-- `name` stays the Razao Social (legal name) — the official identifier that flows to
-- certificates, service-order PDFs and the Conta Azul / Asaas integrations. The new
-- column is an additive, display-only trade name shown in the lab UI (customer list +
-- detail); it never replaces the legal name on a signed document.
--
-- Forward-only and idempotent: IF NOT EXISTS keeps it safe to re-run on the drizzle meta.
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "trade_name" text;
