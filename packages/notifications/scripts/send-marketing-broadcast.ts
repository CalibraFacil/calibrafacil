/**
 * Operator CLI: create (and optionally send) a marketing Broadcast to the
 * Resend lab audience. The Contacts sync (#594) populates the audience; this
 * sends a product-update announcement to it.
 *
 * DEFAULT IS A DRAFT — the broadcast is created for review in the Resend
 * dashboard. Pass the explicit `--send` flag to actually queue/schedule it.
 *
 * Run from the repo root with Bun (resolves the workspace package + node:fs):
 *
 *   bun packages/notifications/scripts/send-marketing-broadcast.ts \
 *     ./announcement.html --subject="Novidades do CalibraFácil" --name="update-2026-06"
 *
 *   # then, after reviewing the draft:
 *   bun packages/notifications/scripts/send-marketing-broadcast.ts \
 *     ./announcement.html --subject="Novidades do CalibraFácil" --name="update-2026-06" --send
 *
 * Required env: RESEND_API_KEY, RESEND_AUDIENCE_ID.
 * Optional env: RESEND_FROM_EMAIL, RESEND_REPLY_TO_EMAIL.
 */
import { readFileSync } from "node:fs";
import { sendMarketingBroadcast } from "../src/resend-broadcast";

interface CliArgs {
  htmlPath?: string;
  subject?: string;
  name?: string;
  preview?: string;
  scheduledAt?: string;
  send: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { send: false };
  for (const arg of argv) {
    if (arg === "--send") args.send = true;
    else if (arg.startsWith("--subject=")) args.subject = arg.slice(10);
    else if (arg.startsWith("--name=")) args.name = arg.slice(7);
    else if (arg.startsWith("--preview=")) args.preview = arg.slice(10);
    else if (arg.startsWith("--scheduled-at=")) args.scheduledAt = arg.slice(15);
    else if (!arg.startsWith("--")) args.htmlPath = arg;
  }
  return args;
}

const USAGE =
  "Usage: bun packages/notifications/scripts/send-marketing-broadcast.ts " +
  "<html-file> --subject=... --name=... [--preview=...] [--scheduled-at=ISO8601] [--send]";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.htmlPath || !args.subject || !args.name) {
    console.error(USAGE);
    process.exit(1);
  }

  const html = readFileSync(args.htmlPath, "utf8");

  const result = await sendMarketingBroadcast(
    {
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      RESEND_AUDIENCE_ID: process.env.RESEND_AUDIENCE_ID,
      RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
      RESEND_REPLY_TO_EMAIL: process.env.RESEND_REPLY_TO_EMAIL,
    },
    {
      subject: args.subject,
      name: args.name,
      previewText: args.preview,
      html,
      send: args.send,
      scheduledAt: args.scheduledAt,
    },
  );

  console.log(args.send ? "Broadcast sent." : "Broadcast draft created.");
  console.log(`  id:        ${result.broadcastId}`);
  console.log(`  status:    ${result.status}`);
  console.log(`  dashboard: https://resend.com/broadcasts/${result.broadcastId}`);
  if (!args.send) {
    console.log(
      "  (DRAFT — review it in the dashboard, then re-run with --send to actually send.)",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
