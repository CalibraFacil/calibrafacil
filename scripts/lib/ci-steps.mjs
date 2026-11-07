// The steps of the `ci` job of .github/workflows/ci.yml, as commands this
// machine can run. `pnpm ci:local` runs these, so a step added to the workflow
// is a step it runs: there is no second list to keep in line.

/**
 * The `run` steps of one job: `{ name, run }` in order. A small reader for the
 * layout the workflow uses (a `steps:` list whose items carry `name:` and either
 * a one-line `run:` or a `run: |` block); steps that `uses:` an action have no
 * `run` and are the runner's setup, not a gate.
 */
export function readJobRunSteps(workflow, job) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start === -1) throw new Error(`No job "${job}" in the workflow`);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }

  const steps = [];
  let current = null;
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index];
    const item = line.match(/^ {6}- (?:name: (.+)|(\w+):.*)$/);
    if (item) {
      current = { name: item[1]?.trim() ?? "", run: null };
      steps.push(current);
      if (item[2] === "run") {
        current.run = line.replace(/^ {6}- run:\s*/, "").trim();
      }
      continue;
    }
    if (!current) continue;

    const name = line.match(/^ {8}name: (.+)$/);
    if (name) current.name = name[1].trim();

    const block = line.match(/^ {8}run: \|\s*$/);
    if (block) {
      const body = [];
      while (index + 1 < end && /^( {10}.*|\s*)$/.test(lines[index + 1])) {
        index += 1;
        body.push(lines[index].replace(/^ {10}/, ""));
      }
      current.run = body.join("\n").trim();
      continue;
    }
    const inline = line.match(/^ {8}run: (.+)$/);
    if (inline) current.run = inline[1].trim();
  }

  return steps.filter((step) => step.run);
}

/**
 * The same command for a machine with Node and pnpm: the workflow runs the
 * repository's scripts through Bun, locally pnpm and Node do the same job.
 */
export function localCommand(run) {
  return run
    .replace(/\bbunx\b/g, "pnpm exec")
    .replace(/\bbun run\b/g, "pnpm run")
    .replace(/\bbun (scripts\/\S+)/g, "node $1");
}
