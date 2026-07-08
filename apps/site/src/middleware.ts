import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The public site is calibrafacil.com. The apex proxies "/" and the marketing
// paths to this deployment, so legitimate requests arrive with
// x-forwarded-host = calibrafacil.com. A DIRECT browser visit to the raw
// production alias arrives with x-forwarded-host = calibra-facil-site.vercel.app
// instead — send those to the canonical domain so the raw URL isn't a public,
// duplicate entry point. The apex proxy is never redirected (its forwarded host
// is calibrafacil.com), so there is no loop. Preview URLs (with a deployment
// hash) don't match RAW_ALIAS and stay browsable for PR testing.
const RAW_ALIAS = "calibra-facil-site.vercel.app";
const CANONICAL_ORIGIN = "https://calibrafacil.com";

export function middleware(request: NextRequest) {
  if (request.headers.get("x-forwarded-host") === RAW_ALIAS) {
    const target = new URL(
      request.nextUrl.pathname + request.nextUrl.search,
      CANONICAL_ORIGIN,
    );
    return NextResponse.redirect(target, 308);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
