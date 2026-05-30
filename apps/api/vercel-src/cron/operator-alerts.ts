import { recomputeOperatorAlerts } from "../../src/lib/operator-alerts";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (
    request.headers.get("authorization") === `Bearer ${secret}` ||
    request.headers.get("x-cron-secret") === secret
  );
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await recomputeOperatorAlerts();
  return Response.json(result);
}

export default {
  fetch: GET,
};
