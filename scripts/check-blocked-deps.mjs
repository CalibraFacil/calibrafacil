import fs from "node:fs";

const lock = fs.readFileSync("pnpm-lock.yaml", "utf8");
const packagesMatch = lock.match(/(?:^|\r?\n)packages:\r?\n([\s\S]*)/);
const packagesSection = packagesMatch?.[1] ?? lock;
const blocked = [
  ["axios@1.14.1", "Blocked due to compromised Axios release on 2026-03-31"],
  ["axios@0.30.4", "Blocked due to compromised Axios release on 2026-03-31"],
  [
    "plain-crypto-js",
    "Blocked due to malicious transitive package in Axios supply-chain attack",
  ],
];

const hits = blocked.filter(([pattern]) => packagesSection.includes(pattern));
if (hits.length) {
  console.error("Blocked dependencies detected in pnpm-lock.yaml:");
  for (const [pattern, reason] of hits) {
    console.error(`- ${pattern}: ${reason}`);
  }
  process.exit(1);
}

console.log("Blocked dependency check passed.");
