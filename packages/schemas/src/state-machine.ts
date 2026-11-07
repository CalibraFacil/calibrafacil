// A lifecycle as data: the states a row (or a process) may be in, the commands
// that move it, and where each command lands from each state.
//
// This generalises the calibration job machine (job-transitions.ts), which was
// the first one written this way. Every machine defined with it is:
//
//   - the single owner of "which command may run from which state and where it
//     lands": routes, the worker, the desktop store and the UI ask it instead of
//     keeping their own status sets;
//   - the input of the compare-and-set WHERE clause of every write
//     (`allowedFrom(command)`), so losing a race is a conflict, not a blind
//     overwrite;
//   - for a Postgres column, the input of a generated trigger
//     (packages/db/src/status-guard-sql.ts) that refuses any status write the
//     table does not list, whoever issues it.
//
// It is pure (no database, no HTTP framework), so every runtime can import it.
//
// A command may land in more than one state from the same state when the target
// depends on data (an evaluation that needs a quote or not, a recomputed chart).
// Such a caller names the target it computed and the machine checks the triple
// (`requireTransition(from, command, to)`); `targetOf` is for commands with one
// target.

export type Transition<S extends string, C extends string> = {
  /** null only for a creation command: there is no prior row to read a state from. */
  readonly from: S | null;
  readonly command: C;
  readonly to: S;
};

export type StateMachineDefinition<S extends string, C extends string> = {
  /** A short name for messages: "service order", "corrective action". */
  readonly name: string;
  readonly states: readonly S[];
  readonly commands: readonly C[];
  readonly transitions: readonly Transition<S, C>[];
};

export type StateMachine<
  S extends string,
  C extends string,
> = StateMachineDefinition<S, C> & {
  /** Narrows a raw value (a database row, a request body) to a state. */
  isState(value: unknown): value is S;
  /** The distinct states `command` may start from, in table order: the CAS WHERE clause. */
  allowedFrom(command: C): S[];
  /** Every state `command` may land in from `from` (null for creation). */
  targetsOf(from: string | null, command: C): S[];
  /**
   * Where `command` lands from `from`, or null when it is not legal there.
   * Throws when the command has several targets from that state: the caller
   * must name the one it computed (`requireTransition`).
   */
  targetOf(from: string | null, command: C): S | null;
  /** Whether `command` is legal from `from` (and lands in `to`, when given). */
  canTransition(from: string | null, command: C, to?: string): boolean;
  /** `targetOf` for a write already checked: throws when illegal. */
  requireTargetOf(from: string | null, command: C): S;
  /** Checks the (from, command, to) triple and returns `to`: throws when illegal. */
  requireTransition(from: string | null, command: C, to: S): S;
  /** The commands legal from `from`, in declaration order (UI allowed actions). */
  commandsFrom(from: string | null): C[];
  /** The states a row may be created in (targets of `from: null`). */
  creationStates(): S[];
  /** Distinct (from, to) moves, no-ops and creation excluded: the database guard. */
  statePairs(): [S, S][];
  /** States no command leaves (self-loops aside). */
  terminalStates(): S[];
};

export class IllegalTransitionError extends Error {
  readonly machine: string;
  readonly from: string | null;
  readonly command: string;
  readonly to: string | null;

  constructor(
    machine: string,
    from: string | null,
    command: string,
    to: string | null,
  ) {
    super(
      `Illegal ${machine} transition: ${command} from ${from ?? "(no state)"}` +
        (to ? ` to ${to}` : ""),
    );
    this.name = "IllegalTransitionError";
    this.machine = machine;
    this.from = from;
    this.command = command;
    this.to = to;
  }
}

/**
 * Builds a machine and validates its table once, at module load: unknown states
 * or commands, duplicate rows and states nothing can reach are programming
 * errors, so they fail every test that imports the machine.
 */
export function defineStateMachine<
  const S extends string,
  const C extends string,
>(definition: StateMachineDefinition<S, C>): StateMachine<S, C> {
  const { name, states, commands, transitions } = definition;
  const stateSet = new Set<string>(states);
  const commandSet = new Set<string>(commands);

  if (stateSet.size !== states.length) {
    throw new Error(`${name}: duplicate state`);
  }
  if (commandSet.size !== commands.length) {
    throw new Error(`${name}: duplicate command`);
  }
  const seen = new Set<string>();
  for (const { from, command, to } of transitions) {
    if (from !== null && !stateSet.has(from)) {
      throw new Error(`${name}: unknown state ${from}`);
    }
    if (!stateSet.has(to)) throw new Error(`${name}: unknown state ${to}`);
    if (!commandSet.has(command)) {
      throw new Error(`${name}: unknown command ${command}`);
    }
    const key = `${from ?? ""}|${command}|${to}`;
    if (seen.has(key)) {
      throw new Error(`${name}: duplicate transition ${key}`);
    }
    seen.add(key);
  }
  for (const command of commands) {
    if (!transitions.some((transition) => transition.command === command)) {
      throw new Error(`${name}: command ${command} has no transition`);
    }
  }
  // Every state must be reachable from a creation state: a state nothing writes
  // is a dead value, not part of the lifecycle.
  const reachable = new Set<string>();
  const frontier: string[] = [];
  for (const { from, to } of transitions) {
    if (from === null && !reachable.has(to)) {
      reachable.add(to);
      frontier.push(to);
    }
  }
  while (frontier.length > 0) {
    const current = frontier.pop();
    for (const { from, to } of transitions) {
      if (from === current && !reachable.has(to)) {
        reachable.add(to);
        frontier.push(to);
      }
    }
  }
  for (const state of states) {
    if (!reachable.has(state)) {
      throw new Error(`${name}: state ${state} is unreachable`);
    }
  }

  const isState = (value: unknown): value is S =>
    typeof value === "string" && stateSet.has(value);

  const targetsOf = (from: string | null, command: C): S[] => {
    const targets: S[] = [];
    for (const transition of transitions) {
      if (
        transition.command === command &&
        transition.from === from &&
        !targets.includes(transition.to)
      ) {
        targets.push(transition.to);
      }
    }
    return targets;
  };

  const targetOf = (from: string | null, command: C): S | null => {
    const targets = targetsOf(from, command);
    if (targets.length > 1) {
      throw new Error(
        `${name}: ${command} from ${from ?? "(no state)"} has several targets; name the one computed`,
      );
    }
    return targets[0] ?? null;
  };

  const canTransition = (
    from: string | null,
    command: C,
    to?: string,
  ): boolean => {
    const targets = targetsOf(from, command);
    if (to === undefined) return targets.length > 0;
    return targets.some((target) => target === to);
  };

  return {
    name,
    states,
    commands,
    transitions,
    isState,
    allowedFrom(command) {
      const from: S[] = [];
      for (const transition of transitions) {
        if (
          transition.command === command &&
          transition.from !== null &&
          !from.includes(transition.from)
        ) {
          from.push(transition.from);
        }
      }
      return from;
    },
    targetsOf,
    targetOf,
    canTransition,
    requireTargetOf(from, command) {
      const target = targetOf(from, command);
      if (target === null) {
        throw new IllegalTransitionError(name, from, command, null);
      }
      return target;
    },
    requireTransition(from, command, to) {
      if (!canTransition(from, command, to)) {
        throw new IllegalTransitionError(name, from, command, to);
      }
      return to;
    },
    commandsFrom(from) {
      return commands.filter((command) =>
        transitions.some(
          (transition) =>
            transition.command === command && transition.from === from,
        ),
      );
    },
    creationStates() {
      const created: S[] = [];
      for (const { from, to } of transitions) {
        if (from === null && !created.includes(to)) created.push(to);
      }
      return created;
    },
    statePairs() {
      const keys = new Set<string>();
      const pairs: [S, S][] = [];
      for (const { from, to } of transitions) {
        if (from === null || from === to) continue;
        const key = `${from}>${to}`;
        if (keys.has(key)) continue;
        keys.add(key);
        pairs.push([from, to]);
      }
      return pairs;
    },
    terminalStates() {
      return states.filter(
        (state) =>
          !transitions.some(
            (transition) =>
              transition.from === state && transition.to !== state,
          ),
      );
    },
  };
}
