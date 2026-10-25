/**
 * npm run audit: the computation audit (tests/audit.test.ts) over the public
 * test files in .corpus/ (npm run corpus downloads them). It fails on any flag
 * not in tests/fixtures/audit-baseline.json, so a fixed computation error can
 * never quietly return. npm run audit:update rewrites the baseline after a
 * reviewed change. The test is skipped in npm test; this script sets
 * LOUPE_AUDIT (and LOUPE_AUDIT_UPDATE) on every platform.
 */
import { spawnSync } from "node:child_process";

const update = process.argv.includes("--update");
const run = spawnSync("npx", ["vitest", "run", "tests/audit.test.ts"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, LOUPE_AUDIT: "1", ...(update ? { LOUPE_AUDIT_UPDATE: "1" } : {}) },
});
if (update)
  spawnSync("npx", ["prettier", "--write", "tests/fixtures/audit-baseline.json"], {
    stdio: "ignore",
    shell: true,
  });
process.exit(run.status ?? 1);
