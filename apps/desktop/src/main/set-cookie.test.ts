import { describe, expect, it } from "vitest";
import {
  parseSetCookie,
  readSetCookieHeaders,
  splitSetCookieHeader,
} from "./set-cookie";

describe("splitSetCookieHeader", () => {
  it("splits on commas between cookies but not inside an Expires date", () => {
    expect(
      splitSetCookieHeader(
        "a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/, b=2; Path=/",
      ),
    ).toEqual([
      "a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/",
      "b=2; Path=/",
    ]);
    expect(splitSetCookieHeader(null)).toEqual([]);
  });

  it("reads each cookie of a response separately", () => {
    const headers = new Headers();
    headers.append("set-cookie", "a=1; Path=/");
    headers.append("set-cookie", "b=2; Path=/");

    expect(readSetCookieHeaders(headers)).toEqual([
      "a=1; Path=/",
      "b=2; Path=/",
    ]);
  });
});

describe("parseSetCookie", () => {
  it("reads the attributes the session store needs", () => {
    expect(
      parseSetCookie(
        "sid=abc=; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=60",
      ),
    ).toMatchObject({
      name: "sid",
      value: "abc=",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "no_restriction",
      deleteCookie: false,
    });
  });

  it("marks an expired cookie for deletion and rejects a nameless one", () => {
    expect(parseSetCookie("sid=; Max-Age=0")?.deleteCookie).toBe(true);
    expect(parseSetCookie("=oops")).toBeNull();
  });
});
