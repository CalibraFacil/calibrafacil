// The Bun the images ship (Dockerfile.*: FROM oven/bun:<version>-slim@sha256:...)
// is the Bun CI runs (.bun-version), and every runtime stage is digest-pinned
// (roadmap 2 G4). Dependabot bumps the Dockerfiles; this keeps .bun-version in
// step with them.
import { readFileSync, readdirSync } from "node:fs";

const expected = readFileSync(".bun-version", "utf8").trim();
const problems = [];
for (const file of readdirSync(".").filter((name) =>
  name.startsWith("Dockerfile."),
)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^FROM\s+(\S+)/);
    if (!match) continue;
    const image = match[1];
    if (!image.includes("@sha256:"))
      problems.push(`${file}: ${image} is not pinned by digest`);
    const bun = image.match(/^oven\/bun:([^@-]+)/);
    if (bun && bun[1] !== expected) {
      problems.push(
        `${file}: Bun ${bun[1]}, but .bun-version says ${expected}`,
      );
    }
  }
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(
  `Docker images pin Bun ${expected} and every base image by digest.`,
);
