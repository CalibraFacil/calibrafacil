import { describe, expect, it } from "vitest";
import { IllegalTransitionError, defineStateMachine } from "./state-machine";

const machine = defineStateMachine({
  name: "door",
  states: ["closed", "open", "locked"],
  commands: ["create", "open", "close", "lock", "check"],
  transitions: [
    { from: null, command: "create", to: "closed" },
    { from: "closed", command: "open", to: "open" },
    { from: "open", command: "close", to: "closed" },
    { from: "closed", command: "lock", to: "locked" },
    { from: "closed", command: "check", to: "closed" },
    { from: "closed", command: "check", to: "locked" },
  ],
});

describe("defineStateMachine", () => {
  it("answers the table", () => {
    expect(machine.allowedFrom("open")).toEqual(["closed"]);
    expect(machine.targetOf("closed", "open")).toBe("open");
    expect(machine.targetOf("open", "open")).toBeNull();
    expect(machine.canTransition("closed", "check", "locked")).toBe(true);
    expect(machine.canTransition("closed", "check", "open")).toBe(false);
    expect(machine.commandsFrom("closed")).toEqual(["open", "lock", "check"]);
    expect(machine.creationStates()).toEqual(["closed"]);
    expect(machine.statePairs()).toEqual([
      ["closed", "open"],
      ["open", "closed"],
      ["closed", "locked"],
    ]);
    expect(machine.terminalStates()).toEqual(["locked"]);
    expect(machine.isState("open")).toBe(true);
    expect(machine.isState("ajar")).toBe(false);
  });

  it("a command with several targets must be told which one was computed", () => {
    expect(() => machine.targetOf("closed", "check")).toThrow(
      /several targets/,
    );
    expect(machine.requireTransition("closed", "check", "locked")).toBe(
      "locked",
    );
    expect(() => machine.requireTransition("open", "check", "locked")).toThrow(
      IllegalTransitionError,
    );
    expect(() => machine.requireTargetOf("locked", "open")).toThrow(
      "Illegal door transition: open from locked",
    );
  });

  it("refuses a malformed table at definition time", () => {
    expect(() =>
      defineStateMachine({
        name: "bad",
        states: ["a", "b"],
        commands: ["create"],
        transitions: [{ from: null, command: "create", to: "a" }],
      }),
    ).toThrow("bad: state b is unreachable");
    expect(() =>
      defineStateMachine({
        name: "bad",
        states: ["a"],
        commands: ["create", "noop"],
        transitions: [{ from: null, command: "create", to: "a" }],
      }),
    ).toThrow("bad: command noop has no transition");
    expect(() =>
      defineStateMachine({
        name: "bad",
        states: ["a"],
        commands: ["create"],
        transitions: [
          { from: null, command: "create", to: "a" },
          { from: null, command: "create", to: "a" },
        ],
      }),
    ).toThrow(/duplicate transition/);
  });
});
