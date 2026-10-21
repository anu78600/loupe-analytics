/**
 * The real-world benchmark (version 40.0): how well Loupe reads tables it was
 * not built around. tests/fixtures/benchmark/*.json hold a few hundred layouts
 * analysts actually work with, one file per family: exports from business
 * tools, practice datasets, and tables analysts make themselves (MIS
 * summaries, pivots, scorecards). Each is expanded to a CSV and run through
 * the same steps as an upload (tests/helpers/layouts.ts).
 *
 * Every layout is labelled with the industry it belongs to (or null when no
 * industry fits), optionally its data shape, and the role of its clearest
 * columns. Measured:
 * - industry: the expected industry ranks first;
 * - confidently wrong: the top industry is wrong and Loupe did not ask, the
 *   failure that matters most (a wrong dashboard presented as right);
 * - shape: the expected data shape is the one picked;
 * - roles: each labelled column profiles with the expected role.
 *
 * About 40% of layouts are held out, chosen by a hash of their id rather
 * than by their authors: work that tunes detection reads the misses of the
 * rest, so the hold-out score is the honest estimate for files nobody has
 * seen. Layouts for industries Loupe doesn't cover yet (PLANNED_INDUSTRIES)
 * are scored apart: until an industry exists, the right answer is to ask.
 *
 * The floors below only move up. `npm run benchmark` also writes the full
 * report to docs/DETECTION-BENCHMARK.md.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { SemanticRole } from "@/engine/profile/types";
import { DOMAINS } from "@/registry";
import { detect, expandFixture, parseCsv, seedOf, type LayoutSpec } from "./helpers/layouts";

/** Industries the benchmark already describes but the registry doesn't have yet. */
// Empty since 43.0 added all ten; list an id here when the corpus describes an industry the registry lacks.
export const PLANNED_INDUSTRIES: readonly string[] = [];

/**
 * The measured floors: raise them as detection improves, never lower them.
 * - 40.0 baseline, 265 layouts, measured with 41.0's refined expander and role
 *   conventions: industry 63.6%, held out 66.7%, shape 85.6%, roles 88.8%,
 *   confidently wrong 2.3%.
 * - 41.0, reading every column: industry 67.3%, held out 68.8%, shape 87.8%,
 *   roles 99.1%, confidently wrong 2.3%.
 * - 42.0, analysts' tables and shop sales: industry 80.0%, held out 80.6%,
 *   shape 89.6%, roles 99.1%, confidently wrong 0.8%.
 * - 43.0, ten more industries (252 of 265 layouts now covered): industry
 *   81.7%, held out 80.8%, shape 89.6%, roles 99.1%, confidently wrong 0.4%.
 */
const FLOORS = {
  /** Industry ranked first, every layout of a covered industry. */
  industry: 0.817,
  /** The same, held-out layouts only. */
  industryHoldout: 0.807,
  /** Shape picked, where a layout names one and its industry was found. */
  shape: 0.896,
  /** Labelled columns given the expected role. */
  roles: 0.99,
  /** At most this share of layouts with a wrong industry presented without asking. */
  confidentlyWrong: 0.004,
};

const ROWS = 240;
const HOLDOUT_SHARE = 0.4;

interface BenchFixture extends LayoutSpec {
  source: string;
  kind: "export" | "dataset" | "analyst";
  /** Expected industry; several when any of them is acceptable; null when no industry fits. */
  expect: string | string[] | null;
  /** Expected data shape (a sub-domain id of the expected industry). */
  shape?: string;
  /** Expected roles of the clearest columns. */
  roles?: Record<string, SemanticRole>;
}

interface FamilyFile {
  family: string;
  description: string;
  fixtures: BenchFixture[];
}

const DIR = join(__dirname, "fixtures", "benchmark");
const FAMILIES: FamilyFile[] = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as FamilyFile);
const ALL = FAMILIES.flatMap((fam) => fam.fixtures.map((f) => ({ family: fam.family, f })));

const COVERED = new Set(DOMAINS.map((d) => d.id));
const PLANNED = new Set<string>(PLANNED_INDUSTRIES);
const ROLES: ReadonlySet<SemanticRole> = new Set<SemanticRole>([
  "identifier",
  "datetime",
  "dimension",
  "measure",
  "rate",
  "currency",
  "percentage",
  "geo",
  "text",
  "boolean",
  "time",
]);

/** Held out when the id's hash falls in the first 40%: fixed by the id, not chosen by whoever wrote it. */
const isHoldout = (id: string) => seedOf(`holdout:${id}`) / 2 ** 32 < HOLDOUT_SHARE;
const expected = (f: BenchFixture): string[] =>
  f.expect === null ? [] : Array.isArray(f.expect) ? f.expect : [f.expect];
type Scope = "covered" | "planned" | "none";
const scopeOf = (f: BenchFixture): Scope =>
  f.expect === null ? "none" : expected(f).some((id) => COVERED.has(id)) ? "covered" : "planned";
/**
 * Whether Loupe's reading of a column matches its label. Three readings count
 * as right although the words differ, because each is how Loupe deliberately
 * treats that kind of column:
 * - a rate and a percentage are the same thing written two ways;
 * - an average, score or rating labelled a measure but read as a rate: Loupe
 *   calls anything that must be averaged, never summed, a rate;
 * - a sales region or zone labelled a category but read as a region-level
 *   place: it is still grouped by, and simply offered to place-based views.
 */
const AVERAGED = /\b(avg|average|mean|median|score|rating|nps|per)\b|\/|_avg|avg_|score/i;
function sameRole(got: SemanticRole, want: SemanticRole, column: string, geoLevel?: string): boolean {
  if (got === want) return true;
  const rates = ["rate", "percentage"];
  if (rates.includes(got) && rates.includes(want)) return true;
  if (want === "measure" && got === "rate" && AVERAGED.test(column.replace(/([a-z])([A-Z])/g, "$1 $2")))
    return true;
  if (want === "dimension" && got === "geo" && geoLevel === "region") return true;
  return false;
}

interface Result {
  family: string;
  f: BenchFixture;
  holdout: boolean;
  scope: Scope;
  top: string | null;
  confidence: number;
  asked: boolean;
  industryOk: boolean;
  confidentlyWrong: boolean;
  shapeOk: boolean | null;
  picked: string | null;
  roles: Array<{ column: string; want: SemanticRole; got: SemanticRole | null; ok: boolean }>;
}

const results: Result[] = [];

beforeAll(async () => {
  for (const { family, f } of ALL) {
    const ds = await parseCsv(expandFixture(f, ROWS), f.id);
    const { profile, detection } = detect(ds);
    const top = detection.candidates[0];
    const scope = scopeOf(f);
    const want = expected(f);
    const industryOk =
      scope === "covered" ? top !== undefined && want.includes(top.domainId) : detection.needsConfirmation;
    const picked = top ? (detection.shapes[top.domainId] ?? top.subDomain.id) : null;
    results.push({
      family,
      f,
      holdout: isHoldout(f.id),
      scope,
      top: top?.domainId ?? null,
      confidence: top?.confidence ?? 0,
      asked: detection.needsConfirmation,
      industryOk,
      confidentlyWrong: !industryOk && !detection.needsConfirmation,
      shapeOk: f.shape && scope === "covered" && industryOk ? picked === f.shape : null,
      picked,
      roles: Object.entries(f.roles ?? {}).map(([column, want]) => {
        const col = profile.columns.find((c) => c.name === column);
        const got = col?.role ?? null;
        return { column, want, got, ok: got !== null && sameRole(got, want, column, col?.geoLevel) };
      }),
    });
  }
  const report = buildReport();
  // Written to stdout rather than console.log, which this Vitest setup hides when every test passes.
  process.stdout.write(`\n${report.summary}\n`);
  if (process.env.LOUPE_BENCH_REPORT)
    writeFileSync(join(__dirname, "..", "docs", "DETECTION-BENCHMARK.md"), report.markdown);
}, 600_000);

// ---------------------------------------------------------------- metrics

const share = (ok: number, n: number) => (n ? ok / n : 1);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function metrics(rs: readonly Result[]) {
  const covered = rs.filter((r) => r.scope === "covered");
  const shapes = rs.filter((r) => r.shapeOk !== null);
  const roles = rs.flatMap((r) => r.roles);
  return {
    layouts: rs.length,
    covered: covered.length,
    industry: share(covered.filter((r) => r.industryOk).length, covered.length),
    industryN: `${covered.filter((r) => r.industryOk).length}/${covered.length}`,
    askedWhenOutside: share(
      rs.filter((r) => r.scope !== "covered" && r.asked).length,
      rs.filter((r) => r.scope !== "covered").length,
    ),
    confidentlyWrong: share(rs.filter((r) => r.confidentlyWrong).length, rs.length),
    confidentlyWrongN: `${rs.filter((r) => r.confidentlyWrong).length}/${rs.length}`,
    shape: share(shapes.filter((r) => r.shapeOk).length, shapes.length),
    shapeN: `${shapes.filter((r) => r.shapeOk).length}/${shapes.length}`,
    roles: share(roles.filter((r) => r.ok).length, roles.length),
    rolesN: `${roles.filter((r) => r.ok).length}/${roles.length}`,
  };
}

function buildReport(): { summary: string; markdown: string } {
  const all = metrics(results);
  const hold = metrics(results.filter((r) => r.holdout));
  const tune = metrics(results.filter((r) => !r.holdout));
  const summary =
    `Benchmark over ${all.layouts} layouts (${hold.layouts} held out): ` +
    `industry ${pct(all.industry)} (${all.industryN}) · held out ${pct(hold.industry)} (${hold.industryN}) · ` +
    `confidently wrong ${pct(all.confidentlyWrong)} (${all.confidentlyWrongN}) · ` +
    `asked when no industry fits ${pct(all.askedWhenOutside)} · shape ${pct(all.shape)} (${all.shapeN}) · ` +
    `roles ${pct(all.roles)} (${all.rolesN})`;

  // Where no covered industry is expected, the right outcome is to ask, so that share is shown instead.
  const row = (name: string, m: ReturnType<typeof metrics>) =>
    `| ${name} | ${m.layouts} | ${m.covered ? `${pct(m.industry)} (${m.industryN})` : `asked ${pct(m.askedWhenOutside)}`} | ${pct(m.confidentlyWrong)} | ${m.shapeN.endsWith("/0") ? "–" : `${pct(m.shape)} (${m.shapeN})`} | ${pct(m.roles)} (${m.rolesN}) |`;
  const head =
    "| | Layouts | Industry first | Confidently wrong | Shape | Column roles |\n| --- | --- | --- | --- | --- | --- |";
  const families = [...new Set(results.map((r) => r.family))];

  // Only the tuning split's misses are listed: work that improves detection reads them, and the held-out
  // layouts stay unseen so their score keeps meaning something. Held-out misses are counted, not shown.
  const tuning = results.filter((r) => !r.holdout);
  const heldMisses = results.filter((r) => r.holdout && !r.industryOk).length;
  const misses = tuning
    .filter((r) => !r.industryOk)
    .sort((a, b) => Number(b.confidentlyWrong) - Number(a.confidentlyWrong) || a.f.id.localeCompare(b.f.id))
    .map(
      (r) =>
        `| ${r.confidentlyWrong ? "**Confidently wrong**" : "Asked"} | ${r.f.source} | ${r.f.expect === null ? "none" : expected(r.f).join(" or ")} | ${r.top ?? "none"} (${r.confidence}%) |`,
    );
  // Each confusion with a few of the column names behind it, the starting point for fixing it.
  const roleMisses = new Map<string, string[]>();
  for (const r of tuning.flatMap((x) => x.roles).filter((x) => !x.ok)) {
    const key = `${r.want} read as ${r.got ?? "missing"}`;
    roleMisses.set(key, [...(roleMisses.get(key) ?? []), r.column]);
  }
  const heldRoleMisses = results
    .filter((r) => r.holdout)
    .flatMap((r) => r.roles)
    .filter((x) => !x.ok).length;
  const shapeMisses = tuning
    .filter((r) => r.shapeOk === false)
    .map((r) => `| ${r.f.source} | ${r.f.shape} | ${r.picked} |`);

  const markdown = [
    "# Detection benchmark",
    "",
    "Generated by `npm run benchmark` from `tests/fixtures/benchmark` (see `tests/benchmark.test.ts` for what each measure means). Do not edit by hand.",
    "",
    `**${summary}.**`,
    "",
    "## By split",
    "",
    head,
    row("All", all),
    row("Held out", hold),
    row("Tuning", tune),
    "",
    "## By family",
    "",
    head,
    ...families.map((fam) => row(fam, metrics(results.filter((r) => r.family === fam)))),
    "",
    "## By scope",
    "",
    "Covered industries must be named; for industries Loupe doesn't cover yet and for tables no industry fits, the right answer is to ask.",
    "",
    head,
    row("Covered industries", metrics(results.filter((r) => r.scope === "covered"))),
    ...(results.some((r) => r.scope === "planned")
      ? [row("Planned industries", metrics(results.filter((r) => r.scope === "planned")))]
      : []),
    row("No industry", metrics(results.filter((r) => r.scope === "none"))),
    "",
    "## Industry misses (tuning split)",
    "",
    `Held-out layouts are counted in the tables above but not listed: ${heldMisses} of them missed.`,
    "",
    "| Outcome | Layout | Expected | Ranked first |",
    "| --- | --- | --- | --- |",
    ...misses,
    "",
    "## Shape misses (tuning split)",
    "",
    "| Layout | Expected | Picked |",
    "| --- | --- | --- |",
    ...shapeMisses,
    "",
    "## Column role misses (tuning split)",
    "",
    `${heldRoleMisses} held-out columns were also misread; they are counted above, not listed.`,
    "",
    "| Expected → read as | Columns | For example |",
    "| --- | --- | --- |",
    ...[...roleMisses.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(
        ([k, cols]) =>
          `| ${k} | ${cols.length} | ${[...new Set(cols)]
            .slice(0, 6)
            .map((c) => `\`${c.trim().replace(/\|/g, "/")}\``)
            .join(", ")} |`,
      ),
    "",
  ].join("\n");
  return { summary, markdown };
}

// ---------------------------------------------------------------- the corpus is well formed

describe("the benchmark corpus", () => {
  it("has a few hundred layouts across families", () => {
    expect(FAMILIES.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ALL.map(({ f }) => f.id)).size).toBe(ALL.length);
  });

  it("labels every layout with industries, shapes and roles that exist", () => {
    const problems: string[] = [];
    for (const { f } of ALL) {
      const at = `${f.id}:`;
      const headers = f.headers ?? [];
      if (headers.length < 2) problems.push(`${at} fewer than 2 headers`);
      if (new Set(headers).size !== headers.length) problems.push(`${at} repeated header`);
      const rows = f.rows ?? [];
      if (rows.length < 4) problems.push(`${at} fewer than 4 sample rows`);
      for (const [i, r] of rows.entries())
        if (r.length !== headers.length)
          problems.push(`${at} row ${i + 1} has ${r.length} cells for ${headers.length} headers`);
      for (const h of [...(f.unique ?? []), ...(f.ids ?? []), ...Object.keys(f.roles ?? {})])
        if (!headers.includes(h)) problems.push(`${at} "${h}" is not a header`);
      for (const id of expected(f))
        if (!COVERED.has(id) && !PLANNED.has(id)) problems.push(`${at} unknown industry "${id}"`);
      if (f.shape) {
        const domain = DOMAINS.find((d) => expected(f).includes(d.id));
        if (!domain) problems.push(`${at} a shape needs a covered industry`);
        else if (!domain.subDomains.some((s) => s.id === f.shape))
          problems.push(`${at} ${domain.id} has no shape "${f.shape}"`);
      }
      for (const [col, role] of Object.entries(f.roles ?? {}))
        if (!ROLES.has(role)) problems.push(`${at} "${col}" has unknown role "${role}"`);
      if (!["export", "dataset", "analyst"].includes(f.kind)) problems.push(`${at} unknown kind "${f.kind}"`);
    }
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------- floors

describe("detection on the real-world benchmark", () => {
  it("names the industry of covered layouts", () => {
    expect(metrics(results).industry).toBeGreaterThanOrEqual(FLOORS.industry);
  });

  it("names it on held-out layouts nobody tuned against", () => {
    expect(metrics(results.filter((r) => r.holdout)).industry).toBeGreaterThanOrEqual(FLOORS.industryHoldout);
  });

  it("rarely presents a wrong industry without asking", () => {
    expect(metrics(results).confidentlyWrong).toBeLessThanOrEqual(FLOORS.confidentlyWrong);
  });

  it("picks the data shape", () => {
    expect(metrics(results).shape).toBeGreaterThanOrEqual(FLOORS.shape);
  });

  it("reads each labelled column's role", () => {
    expect(metrics(results).roles).toBeGreaterThanOrEqual(FLOORS.roles);
  });
});
