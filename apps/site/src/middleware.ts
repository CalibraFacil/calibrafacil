import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// TEMP diagnostic: expose the forwarding headers so we can tell a direct visit
// to the raw *.vercel.app deployment apart from the apex proxy before adding a
// redirect. No redirect yet.
export function middleware(request: NextRequest) {
  const res = NextResponse.next();
  res.headers.set(
    "x-cf-fwd-host",
    request.headers.get("x-forwarded-host") ?? "none",
  );
  res.headers.set("x-cf-host", request.headers.get("host") ?? "none");
  return res;
}

export const config = { matcher: "/" };
