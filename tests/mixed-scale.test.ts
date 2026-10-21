/**
 * Numbers on two scales (profile/scales.ts, quality.ts, dataCheck.ts): a
 * reading whose values sit in groups a power of ten apart, as a lost decimal
 * point or a misread thousands separator leaves them, is a warning in the
 * health report, and the data check marks exactly the values off the
 * column's commonest scale. Each says how many values, how far apart, and a
 * pair of values taken from the file. Nothing is changed in the data.
 *
 * Nothing else is flagged: skewed money (₹10 to ₹10 lakh), money in two
 * bands, counts with a long tail, the figures of a tall scorecard,
 * identifiers and codes, clean readings, a column written on another scale
 * as a whole (alcohol as 0.105), a repeated placeholder such as 999, or two
 * groups only 10× apart.
 */
import { describe, expect, it } from "vitest";
import type { Column, Dataset, NumberColumn } from "@/engine/core/types";
import { Rng } from "@/engine/core/random";
import { DataCheck } from "@/engine/profile/dataCheck";
import { profileDataset } from "@/engine/profile/profile";
import { assessHealth, type HealthIssue } from "@/engine/profile/quality";
import { mixedScales } from "@/engine/profile/scales";
import { Session } from "@/engine/session";
import { parse } from "./helpers/dataset";

// ---------------------------------------------------------------- helpers

const round = (x: number, decimals: number) => Number(x.toFixed(decimals));

function numberCol(name: string, values: number[]): NumberColumn {
  return {
    kind: "number",
    name,
    values: Float64Array.from(values),
    format: { integer: values.every(Number.isInteger), decimals: 4 },
  };
}

function dataset(columns: Column[]): Dataset {
  const first = columns[0] as NumberColumn;
  return {
    id: "t",
    name: "t",
    rowCount: first.values.length,
    columns,
    source: { fileName: "t.csv", kind: "csv", sizeBytes: 0, isDemo: false },
  };
}

/** The health issues about numbers on several scales. */
function scaleIssues(ds: Dataset): HealthIssue[] {
  return assessHealth(ds, profileDataset(ds)).issues.filter((i) => i.id.startsWith("scales-"));
}

/** "1,215.5" or "−0.04" as written in an issue → the number. */
const figure = (s: string) => Number(s.replace(/,/g, "").replace("−", "-"));

/** Readings around `mean` with spread `sd`, rounded as a file writes them. */
function readings(rng: Rng, n: number, mean: number, sd: number, decimals: number): number[] {
  return Array.from({ length: n }, () => round(Math.max(mean / 4, rng.normal(mean, sd)), decimals));
}

// ---------------------------------------------------------------- lost decimal points, end to end

describe("a lost decimal point, ×1,000 and ×100", async () => {
  const N = 400;
  const rng = new Rng(2026);
  const density: number[] = [];
  const ph: number[] = [];
  const sulphates: number[] = [];
  const densityOff: number[] = [];
  const phOff: number[] = [];
  for (let i = 0; i < N; i++) {
    const d = round(rng.normal(0.994, 0.0025), 4);
    const p = round(rng.normal(3.19, 0.15), 2);
    sulphates.push(round(rng.normal(0.49, 0.1), 2));
    // Every 25th density read "0.9912" as 991.2, every 40th pH lost its point: "3.21" became 321.
    if (i % 25 === 3) {
      densityOff.push(i);
      density.push(round(d * 1000, 1));
    } else density.push(d);
    if (i % 40 === 7) {
      phOff.push(i);
      ph.push(round(p * 100, 0));
    } else ph.push(p);
  }
  const csv = [
    "Sample,density,pH,sulphates",
    ...density.map((d, i) => `S${1000 + i},${d},${ph[i]},${sulphates[i]}`),
  ].join("\n");
  const s = new Session();
  const load = await s.ingest(new Blob([csv]), "wine-lab.csv", {});
  if (load.status !== "ok") throw new Error(load.status);
  const issue = (column: string) => load.health.issues.find((i) => i.id === `scales-${column}`);
  const colIndex = (name: string) => load.profile.columns.findIndex((c) => c.name === name);

  it("warns once per column, with the number of values, the factor and a pair from the file", () => {
    const d = issue("density");
    expect(d).toMatchObject({
      severity: "warning",
      column: "density",
      title: 'Values on two scales in "density"',
      count: densityOff.length,
      penalty: 6,
    });
    const m = d?.detail.match(
      /^16 values look 1,000× larger than the rest \((\S+) next to (\S+)\)\. Probably a lost decimal point; fix it in the source file\.$/,
    );
    expect(m, d?.detail).toBeTruthy();
    // Both values of the pair are in the file, and they are about 1,000× apart.
    const [big, small] = [figure(m?.[1] ?? ""), figure(m?.[2] ?? "")];
    expect(density).toContain(big);
    expect(density).toContain(small);
    expect(big / small).toBeGreaterThan(900);
    expect(big / small).toBeLessThan(1100);

    const p = issue("pH");
    expect(p?.count).toBe(phOff.length);
    expect(p?.detail).toMatch(
      /^10 values look 100× larger than the rest \(\S+ next to \S+\)\. Probably a lost decimal point/,
    );
    expect(issue("sulphates")).toBeUndefined();
    expect(load.health.checks.find((c) => c.id === "scales")).toMatchObject({
      label: "Consistent number scales",
      passed: false,
    });
  });

  it("marks exactly the values off the commonest scale in the data check", () => {
    const views = s.checkViews();
    expect(views.find((v) => v.id === "issue:scales-density")?.rows).toBe(densityOff.length);
    expect(views.find((v) => v.id === "issue:scales-pH")?.rows).toBe(phOff.length);
    const all = s.checkRows("all", 0, N).rows;
    const marked = (column: string) =>
      all.filter((r) => r.problems.some((p) => p.column === colIndex(column))).map((r) => r.index);
    expect(marked("density")).toEqual(densityOff);
    expect(marked("pH")).toEqual(phOff);
    expect(marked("sulphates")).toEqual([]);
    const note = all[densityOff[0] as number]?.problems.find((p) => p.column === colIndex("density"));
    expect(note).toMatchObject({ kind: "value", tone: "warning" });
    expect(note?.note).toMatch(
      /^1,000× larger than this column's usual values \(such as \S+\): probably a lost decimal point\.$/,
    );
    // Every marked row is a row to check.
    const toCheck = s.checkRows("problems", 0, N).rows.map((r) => r.index);
    for (const r of [...densityOff, ...phOff]) expect(toCheck).toContain(r);
  });

  it("changes nothing: the values stay as the file wrote them", () => {
    const first = densityOff[0] as number;
    expect(Number(s.checkRows("all", first, 1).rows[0]?.cells[colIndex("density")])).toBe(density[first]);
  });

  it("is left out with the column when the column is hidden", () => {
    const ctx = s.configure({
      domainId: "generic",
      numberLocale: "INTL",
      currency: null,
      hiddenColumns: ["density"],
    });
    expect(ctx.health.issues.some((i) => i.id === "scales-density")).toBe(false);
    expect(ctx.health.issues.some((i) => i.id === "scales-pH")).toBe(true);
  });
});

// ---------------------------------------------------------------- other shapes of the same problem

describe("other shapes of the problem", () => {
  it("names the smaller scale when it is the minority (the rest lost the point)", () => {
    // Chlorides of 0.045 read as 45 on most rows; 20 rows kept 0.045.
    const rng = new Rng(11);
    const values = readings(rng, 400, 0.046, 0.01, 3).map((v, i) => (i % 20 === 5 ? v : round(v * 1000, 0)));
    const [issue] = scaleIssues(dataset([numberCol("chlorides", values)]));
    expect(issue?.count).toBe(20);
    expect(issue?.detail).toMatch(/^20 values look 1,000× smaller than the rest \(0\.0\d+ next to \d+\)\./);
  });

  it("lists three or more scales from the smallest up", () => {
    // Densities written four ways: 0.9931, 9.931, 99.31 and 993.1.
    const rng = new Rng(12);
    const factor = (i: number) => (i < 30 ? 1 : i < 190 ? 10 : i < 360 ? 100 : 1000);
    const values = readings(rng, 400, 0.994, 0.0025, 4).map((v, i) => round(v * factor(i), 4));
    const [issue] = scaleIssues(dataset([numberCol("density", values)]));
    expect(issue?.title).toBe('Values on four scales in "density"');
    // The rows off the commonest scale (×100, 170 rows) are the ones marked.
    expect(issue?.count).toBe(230);
    const m = issue?.detail.match(
      /^Values sit on four scales a power of ten apart: (\S+) \(30 rows\), (\S+) \(160\), (\S+) \(170\) and (\S+) \(40\)\. Probably lost decimal points; fix them in the source file\.$/,
    );
    expect(m, issue?.detail).toBeTruthy();
    const examples = (m ?? []).slice(1).map(figure);
    for (let k = 1; k < examples.length; k++) {
      const ratio = (examples[k] as number) / (examples[k - 1] as number);
      expect(ratio).toBeGreaterThan(9);
      expect(ratio).toBeLessThan(11);
    }
  });

  it("finds a group a million times larger", () => {
    const rng = new Rng(13);
    const values = readings(rng, 300, 2.5, 0.3, 2).map((v, i) => (i % 30 === 0 ? v * 1e6 : v));
    const [issue] = scaleIssues(dataset([numberCol("turbidity", values)]));
    expect(issue?.detail).toMatch(/^10 values look 1,000,000× larger than the rest/);
  });

  it("says fractions and points for a share", () => {
    // A discount written as 0.15 on most rows and as 15 on some.
    const rng = new Rng(14);
    const values = readings(rng, 400, 0.2, 0.06, 2).map((v, i) => (i % 20 === 9 ? round(v * 100, 0) : v));
    const ds = dataset([numberCol("Discount %", values)]);
    expect(profileDataset(ds).columns[0]?.role).toBe("percentage");
    const [issue] = scaleIssues(ds);
    expect(issue?.count).toBe(20);
    expect(issue?.detail).toMatch(
      /^20 values look 100× larger than the rest \(\S+ next to \S+\)\. Probably some shares are written as fractions and some as percentage points; fix it in the source file\.$/,
    );
    const profile = profileDataset(ds);
    const health = assessHealth(ds, profile);
    const check = new DataCheck(ds, profile, health, (c, r) =>
      String((ds.columns[c] as NumberColumn).values[r]),
    );
    expect(check.rows("issue:scales-Discount %", 0, 1).rows[0]?.problems[0]?.note).toMatch(
      /^100× larger than this column's usual values \(such as \S+\): probably a share written as points, not as a fraction\.$/,
    );
  });
});

// ---------------------------------------------------------------- what is not two scales

describe("what is not two scales", () => {
  it("skewed money: revenue from ₹10 to ₹10 lakh", () => {
    const rng = new Rng(21);
    const revenue = [
      10,
      10_00_000,
      ...Array.from({ length: 2998 }, () =>
        round(Math.min(9_99_999, Math.max(10, 10 ** rng.normal(3, 0.8))), 2),
      ),
    ];
    expect(scaleIssues(dataset([numberCol("Revenue (₹)", revenue)]))).toEqual([]);
    // Not only because money is never tested: the values themselves form one group.
    expect(mixedScales(Float64Array.from(revenue))).toBeNull();
  });

  it("money in two bands (fees beside transfers) is never tested", () => {
    const rng = new Rng(22);
    const amounts = Array.from({ length: 500 }, (_, i) =>
      i % 3 ? round(rng.float(10, 50), 2) : round(rng.float(10_000, 50_000), 2),
    );
    expect(mixedScales(Float64Array.from(amounts))).not.toBeNull();
    expect(scaleIssues(dataset([numberCol("Amount (₹)", amounts)]))).toEqual([]);
  });

  it("counts with a long tail", () => {
    const rng = new Rng(23);
    const units = Array.from({ length: 3000 }, () => Math.floor(10 ** (rng.next() ** 3 * 3.7)));
    expect(scaleIssues(dataset([numberCol("Units Sold", units)]))).toEqual([]);
    expect(mixedScales(Float64Array.from(units))).toBeNull();
    // A reading with a long tail is tested, and is one scale too.
    const hours = Array.from({ length: 3000 }, () => round(10 ** rng.normal(0.5, 0.7), 1) || 0.1);
    expect(scaleIssues(dataset([numberCol("Hours Watched", hours)]))).toEqual([]);
  });

  it("the figures of a tall scorecard, where each metric has its own scale", async () => {
    // Gross NPA of about 2.5% beside advances of about ₹250 Cr: 100× apart by design, not by a lost point.
    const metrics: Array<[string, number]> = [
      ["Gross NPA %", 2.5],
      ["Cross-sell Ratio", 1.9],
      ["CASA Ratio %", 42],
      ["New Accounts", 150],
      ["Advances (₹ Cr)", 250],
      ["Deposits (₹ Cr)", 1200],
    ];
    const lines = ["Month,Branch,Metric,Value"];
    ["2024-04", "2024-05", "2024-06"].forEach((month, m) =>
      ["Andheri", "Borivali", "Thane", "Pune Camp"].forEach((branch, b) =>
        metrics.forEach(([metric, base]) =>
          lines.push(
            `${month},${branch},"${metric}",${round(base * (1 + 0.01 * (m + 1) + 0.003 * (b + 1)), 2)}`,
          ),
        ),
      ),
    );
    const { ds } = await parse(lines.join("\n"), "branch-scorecard.csv");
    const profile = profileDataset(ds);
    expect(profile.tall?.valueColumns).toEqual(["Value"]);
    expect(mixedScales((ds.columns.find((c) => c.name === "Value") as NumberColumn).values)).not.toBeNull();
    expect(assessHealth(ds, profile).issues.filter((i) => i.id.startsWith("scales-"))).toEqual([]);
  });

  it("identifiers and codes", () => {
    const rng = new Rng(24);
    // Two numbering schemes 1,000× apart, and codes written 1.10 and 110: groups the values alone would flag.
    const ids = Array.from({ length: 400 }, (_, i) => (i % 4 ? 1001 + i : 1_001_000 + i * 997));
    const codes = Array.from({ length: 400 }, (_, i) => round(rng.float(1.1, 9.9), 2) * (i % 4 ? 1 : 100));
    expect(mixedScales(Float64Array.from(ids))).not.toBeNull();
    expect(mixedScales(Float64Array.from(codes))).not.toBeNull();
    const ds = dataset([numberCol("Customer ID", ids), numberCol("Account Code", codes)]);
    expect(scaleIssues(ds)).toEqual([]);
  });

  it("clean readings, and a column written on another scale as a whole", () => {
    const rng = new Rng(25);
    const n = 600;
    const ds = dataset([
      numberCol("pH", readings(rng, n, 3.19, 0.15, 2)),
      numberCol("density", readings(rng, n, 0.994, 0.003, 5)),
      // Residual sugar spans two powers of ten without a gap; citric acid has zeros.
      numberCol(
        "residual sugar",
        readings(rng, n, 1, 0.1, 2).map((v, i) => round(v * 10 ** ((i % 9) / 4.5), 1)),
      ),
      numberCol(
        "citric acid",
        readings(rng, n, 0.33, 0.12, 2).map((v, i) => (i % 50 ? v : 0)),
      ),
      // Alcohol of 10.5 written as 0.105 on every row: one scale, nothing in the values shows it.
      numberCol("alcohol_new", readings(rng, n, 0.105, 0.012, 4)),
    ]);
    expect(profileDataset(ds).columns.every((c) => c.role === "measure")).toBe(true);
    expect(scaleIssues(ds)).toEqual([]);
    expect(assessHealth(ds, profileDataset(ds)).checks.find((c) => c.id === "scales")?.passed).toBe(true);
  });

  it("a placeholder such as 999, repeated", () => {
    const rng = new Rng(26);
    const gravity = readings(rng, 600, 1, 0.01, 3);
    // 999 standing in for a missing gravity: one value repeated is a placeholder, not a scale.
    expect(
      scaleIssues(
        dataset([
          numberCol(
            "specific gravity",
            gravity.map((v, i) => (i % 40 ? v : 999)),
          ),
        ]),
      ),
    ).toEqual([]);
    // The same rows holding gravities ×1,000 (different values) are a second scale.
    const shifted = gravity.map((v, i) => (i % 40 ? v : round(v * 1000, 0)));
    expect(scaleIssues(dataset([numberCol("specific gravity", shifted)]))[0]?.count).toBe(15);
  });

  it("two groups only 10× apart (a 50 g and a 500 g pack)", () => {
    const rng = new Rng(27);
    const fill = readings(rng, 600, 50, 0.4, 1);
    expect(
      scaleIssues(
        dataset([
          numberCol(
            "fill weight",
            fill.map((v, i) => (i % 3 ? v : round(v * 10, 1))),
          ),
        ]),
      ),
    ).toEqual([]);
    // 100× apart is a second scale.
    const shifted = fill.map((v, i) => (i % 3 ? v : round(v * 100, 1)));
    expect(scaleIssues(dataset([numberCol("fill weight", shifted)]))[0]?.count).toBe(200);
  });
});
