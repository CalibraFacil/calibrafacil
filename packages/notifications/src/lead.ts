import { Resend } from "resend";
import { render } from "@react-email/render";
import { NewLeadEmail } from "@calibra-facil/email";

export interface NewLeadNotification {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  segment: string;
  message?: string;
  utmSource?: string;
  utmCampaign?: string;
  referrer?: string;
}

/**
 * Notify the internal sales inbox about a new marketing-site lead. Best-effort:
 * a missing env / send failure is logged and returns false so the lead is still
 * persisted (the row is the source of truth; the email is a convenience).
 * `replyTo` is the lead's address so the team can reply straight from the inbox.
 */
export async function notifyNewLead(
  lead: NewLeadNotification,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const to = process.env.SALES_INBOX_EMAIL;

  if (!apiKey || !fromEmail || !to) {
    console.warn(
      "[Leads] Missing RESEND_API_KEY / RESEND_FROM_EMAIL / SALES_INBOX_EMAIL — skipping lead notification email",
    );
    return false;
  }

  try {
    const submittedAt = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
    const html = await render(NewLeadEmail({ ...lead, submittedAt }));
    const resend = new Resend(apiKey);

    await resend.emails.send({
      from: fromEmail,
      to,
      subject: `Novo lead: ${lead.name}${lead.company ? ` — ${lead.company}` : ""}`,
      html,
      replyTo: lead.email,
    });

    return true;
  } catch (error) {
    console.error("[Leads] Failed to send lead notification email:", error);
    return false;
  }
}
