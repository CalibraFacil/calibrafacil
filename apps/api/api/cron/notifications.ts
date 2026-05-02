import { enqueueBackgroundJob } from "../../src/lib/background-jobs";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (
    request.headers.get("authorization") === `Bearer ${secret}` ||
    request.headers.get("x-cron-secret") === secret
  );
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await enqueueBackgroundJob(
    { type: "SCHEDULED_NOTIFICATIONS" },
    { idempotencyKey: `scheduled-notifications-${todayKey()}` },
  );

  return Response.json(result);
}

export default {
  fetch: GET,
};
