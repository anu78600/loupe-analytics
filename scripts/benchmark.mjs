/**
 * npm run benchmark: runs the real-world detection benchmark
 * (tests/benchmark.test.ts) and writes its full report, per family, split and
 * scope with every miss, to docs/DETECTION-BENCHMARK.md. The test itself only
 * prints the summary line; the report is written when LOUPE_BENCH_REPORT is
 * set, which this script does on every platform, and the report is then
 * formatted with Prettier.
 */
import { spawnSync } from "node:child_process";

const run = spawnSync("npx", ["vitest", "run", "tests/benchmark.test.ts"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, LOUPE_BENCH_REPORT: "1" },
});
// Formatted like every other doc, so the report passes the repo's Prettier check as written.
spawnSync("npx", ["prettier", "--write", "docs/DETECTION-BENCHMARK.md"], { stdio: "ignore", shell: true });
process.exit(run.status ?? 1);
