import { SYNC_PROTOCOL_VERSION } from "@calibra-facil/contracts";
import { describe, expect, it } from "vitest";

import { PushProtocolMemo, eventsCarriedBy } from "./push-protocol";

describe("PushProtocolMemo", () => {
  it("speaks this build's protocol until a cloud says it speaks less", () => {
    const memo = new PushProtocolMemo();
    expect(memo.protocolFor("https://a.example")).toBe(SYNC_PROTOCOL_VERSION);

    memo.remember("https://a.example", 3);

    expect(memo.protocolFor("https://a.example")).toBe(3);
    expect(memo.protocolFor("https://b.example")).toBe(SYNC_PROTOCOL_VERSION);
  });

  it("is the state of one memo, not of the process", () => {
    const first = new PushProtocolMemo();
    const second = new PushProtocolMemo();

    first.remember("https://a.example", 3);

    expect(second.protocolFor("https://a.example")).toBe(SYNC_PROTOCOL_VERSION);
  });

  it("forgets a downgrade after ten minutes, so an upgraded cloud is asked again", () => {
    let now = 1_000;
    const memo = new PushProtocolMemo(() => now);
    memo.remember("https://a.example", 3);

    now += 9 * 60_000;
    expect(memo.protocolFor("https://a.example")).toBe(3);

    now += 2 * 60_000;
    expect(memo.protocolFor("https://a.example")).toBe(SYNC_PROTOCOL_VERSION);
  });
});

describe("eventsCarriedBy", () => {
  const events = [
    { operation: "create_local_asset", id: 1 },
    { operation: "create_local_attachment", id: 2 },
    { operation: "create_local_customer", id: 3 },
  ];

  it("keeps an attachment event out of a push the cloud cannot verify, whatever else travels", () => {
    expect(eventsCarriedBy(events, 3).map((event) => event.id)).toEqual([1, 3]);
  });

  it("carries everything once the cloud speaks the attachment protocol", () => {
    expect(eventsCarriedBy(events, SYNC_PROTOCOL_VERSION)).toEqual(events);
  });
});
