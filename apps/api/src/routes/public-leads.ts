import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { LeadSubmissionSchema } from "@calibra-facil/schemas";

import { createLead } from "../services/leads";

// Public, UNAUTHENTICATED marketing lead capture. No auth spread, not
// org-scoped — mounted under /api/public/*. Responses are never cached or
// indexed.
export const publicLeadsRouter = new Hono()
  .use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "private, no-store, max-age=0");
    c.header("X-Robots-Tag", "noindex, nofollow");
  })
  .post("/", zValidator("json", LeadSubmissionSchema), async (c) => {
    const input = c.req.valid("json");

    try {
      await createLead(input);
      return c.json({ ok: true });
    } catch (error) {
      console.error("[Leads] Failed to persist lead:", error);
      return c.json({ error: "Falha ao registrar seu contato" }, 500);
    }
  });
