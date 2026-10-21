/**
 * Tables of measurements (version 48.1): a Wine Quality-shaped table, built
 * here with realistic values, comes out right end to end.
 *
 * - Roles: every reading (acidity, pH, chlorides, sulfur dioxide, density,
 *   alcohol) and the quality score are averaged, never summed; a table of
 *   measurements reads even unnamed numbers as readings, while a sales table
 *   still sums its amounts.
 * - Matching: a synonym made only of generic words ("total", "free") never
 *   gives "total sulfur dioxide" or "free sulfur dioxide" to a money or
 *   quantity field in any industry, while "Grand Total", "Net Amount",
 *   "Total (₹)" and "Order Total" still match; detection asks.
 * - The general dashboard is built around the quality score: the sentence,
 *   rows, average quality, the share rated 7 or above, the average of the
 *   characteristic that moves most with quality (worked out here from the
 *   generator's own rows), the score distribution in the scale's order, the
 *   averages by score, a scatter and a table. Nothing is summed, and every
 *   KPI compiles to SQL and DAX that DuckDB agrees with.
 * - An industry chosen anyway (Pharma) is flagged as a weak fit, and its
 *   dashboard is filled with the general charts instead of left empty.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Session, type ContextResult } from "@/engine/session";
import type { ExportContext } from "@/engine/export/context";
import type { Expr } from "@/engine/query/expr";
import { profileDataset } from "@/engine/profile/profile";
import type { ColumnProfile, DatasetProfile } from "@/engine/profile/types";
import { pearson } from "@/engine/core/stats";
import { detectDomain } from "@/engine/detect/detect";
import { assignFields, matchableColumns, MATCH_THRESHOLD, scoreField } from "@/engine/detect/match";
import { SAMPLES } from "@/engine/samples";
import { DOMAINS, getDomain } from "@/registry";
import type { DomainDef, FieldDef } from "@/registry/schema";
import { close, loadIntoDuckDB, scalar } from "./helpers/duck";
import { csvCell, parseCsv, rng } from "./helpers/layouts";

// ---------------------------------------------------------------- a Wine Quality-shaped table

const HEADERS = [
  "fixed acidity",
  "volatile acidity",
  "citric acid",
  "residual sugar",
  "chlorides",
  "free sulfur dioxide",
  "total sulfur dioxide",
  "density",
  "pH",
  "sulphates",
  "alcohol",
  "quality",
] as const;
type Wine = Record<(typeof HEADERS)[number], number>;

const ROWS = 600;

/**
 * Wines shaped like the UCI white-wine data: quality 3–9, mostly 5–7; alcohol
 * rising with quality, density falling with alcohol, chlorides and volatile
 * acidity falling slightly with quality; values rounded as the file writes them.
 */
function wines(n = ROWS): Wine[] {
  const rand = rng(48_1);
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const round = (x: number, d: number) => Number(x.toFixed(d));
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  // Shares of each score in the original 4,898 wines, from 3 to 9.
  const share = [0.004, 0.033, 0.297, 0.449, 0.18, 0.036, 0.001];
  const out: Wine[] = [];
  for (let i = 0; i < n; i++) {
    let q = 3;
    if (i === 0) q = 3;
    else if (i === 1) q = 9;
    else {
      let u = rand();
      for (let k = 0; k < share.length; k++) {
        u -= share[k] as number;
        if (u <= 0 || k === share.length - 1) {
          q = 3 + k;
          break;
        }
      }
    }
    const d = q - 5.88;
    const alcohol = clamp(10.5 + 0.75 * d + normal(), 8, 14.2);
    const totalSo2 = clamp(138 - 6 * d + 40 * normal(), 9, 440);
    out.push({
      "fixed acidity": round(clamp(6.85 + 0.8 * normal(), 3.8, 14.2), 1),
      "volatile acidity": round(clamp(0.278 - 0.02 * d + 0.09 * normal(), 0.08, 1.1), 3),
      "citric acid": round(clamp(0.33 + 0.12 * normal(), 0, 1.66), 2),
      "residual sugar": round(0.6 + Math.abs(5.8 + 5 * normal()), 1),
      chlorides: round(clamp(0.0458 - 0.004 * d + 0.01 * normal(), 0.009, 0.346), 3),
      "free sulfur dioxide": Math.round(clamp(0.25 * totalSo2 + 12 * normal(), 2, 289)),
      "total sulfur dioxide": Math.round(totalSo2),
      density: round(0.994 - 0.0012 * (alcohol - 10.5) + 0.0015 * normal(), 5),
      pH: round(clamp(3.19 + 0.15 * normal(), 2.72, 3.82), 2),
      sulphates: round(clamp(0.49 + 0.11 * normal(), 0.22, 1.08), 2),
      alcohol: round(alcohol, 1),
      quality: q,
    });
  }
  return out;
}

const WINES = wines();
const csvOf = (headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number>>) =>
  [headers.map(csvCell).join(","), ...rows.map((r) => r.map((v) => csvCell(String(v))).join(","))].join("\n");
const WINE_CSV = csvOf(
  HEADERS,
  WINES.map((w) => HEADERS.map((h) => w[h])),
);

const col = (p: DatasetProfile, name: string): ColumnProfile => {
  const c = p.columns.find((x) => x.name === name);
  if (!c) throw new Error(`no column ${name}`);
  return c;
};

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

/** Runs every KPI's SQL in DuckDB and returns the mismatches with the engine's whole-file values. */
async function duckMismatches(s: Session): Promise<string[]> {
  const ec = (s as unknown as { exportContext(): ExportContext }).exportContext();
  const bundle = s.verificationBundle();
  const conn = await loadIntoDuckDB(ec.ds, bundle.table, ec.names.columns);
  connections.push(conn);
  const out: string[] = [];
  for (const q of bundle.queries) {
    const got = await scalar(conn, q.sql);
    const want = q.engine ?? NaN;
    const same =
      (Number.isNaN(got) && Number.isNaN(want)) || Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want));
    if (!same) out.push(`${q.id}: DuckDB ${got} vs engine ${want}`);
  }
  return out;
}

/** True when an expression sums anything, following no refs. */
function sums(e: Expr): boolean {
  if ("agg" in e) return e.agg === "sum";
  if ("op" in e) return e.args.some(sums);
  if ("calc" in e) return sums(e.calc);
  if ("atLatest" in e) return sums(e.expr);
  if ("per" in e) return sums(e.inner);
  return false;
}

// ---------------------------------------------------------------- roles

describe("the roles of a table of measurements", async () => {
  const p = profileDataset(await parseCsv(WINE_CSV, "winequality-white"));

  it("averages every reading and the quality score, never sums them", () => {
    for (const h of HEADERS) {
      const c = col(p, h);
      expect(c.role, h).toBe("measure");
      expect(c.additivity, h).toBe("non-additive");
      expect(c.defaultAgg, h).toBe("avg");
    }
    expect(col(p, "quality").roleReason).toMatch(/ordinal score/);
    // "pH" is read from the raw name, which tokenises as two letters.
    expect(col(p, "pH").roleReason).toMatch(/reading/);
  });

  it("reads unnamed numbers in a table of measurements as readings", async () => {
    const rand = rng(7);
    const rows = Array.from({ length: 150 }, (_, i) => [
      (4.5 + rand() * 3).toFixed(1),
      (2 + rand() * 2.4).toFixed(1),
      (1 + rand() * 5.9).toFixed(1),
      (0.1 + rand() * 2.4).toFixed(1),
      ["setosa", "versicolor", "virginica"][Math.floor(i / 50)] as string,
    ]);
    const iris = profileDataset(
      await parseCsv(
        csvOf(["sepal_length", "sepal_width", "petal_length", "petal_width", "species"], rows),
        "iris",
      ),
    );
    for (const name of ["sepal_width", "petal_width"]) {
      expect(col(iris, name).additivity, name).toBe("non-additive");
      expect(col(iris, name).roleReason, name).toMatch(/table of measurements/);
    }
  });

  it("still sums the amounts and quantities of a sales table", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => [
      `ORD-${1000 + i}`,
      `2025-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, "0")}`,
      ["North", "South", "East", "West"][i % 4] as string,
      1 + (i % 7),
      (250 + i * 13.5).toFixed(2),
      (40 + (i % 11) * 2.5).toFixed(2),
    ]);
    const sales = profileDataset(
      await parseCsv(
        csvOf(["Order ID", "Order Date", "Region", "Quantity", "Amount", "Discount"], rows),
        "sales",
      ),
    );
    expect(col(sales, "Amount").role).toBe("currency");
    expect(col(sales, "Amount").additivity).toBe("additive");
    expect(col(sales, "Quantity").additivity).toBe("additive");
    // A table with IDs, dates and amounts is no table of measurements: nothing becomes a reading.
    expect(sales.columns.some((c) => /table of measurements/.test(c.roleReason))).toBe(false);
  });
});

// ---------------------------------------------------------------- matching and detection

describe("matching on one generic word", async () => {
  const p = profileDataset(await parseCsv(WINE_CSV, "winequality-white"));

  it("gives total and free sulfur dioxide to no field in any industry", () => {
    for (const d of DOMAINS) {
      const assigned = assignFields(d, matchableColumns(p));
      for (const name of ["total sulfur dioxide", "free sulfur dioxide"])
        expect(
          assigned.find((a) => a.column === name),
          `${d.id} maps ${name}`,
        ).toBeUndefined();
    }
    const freeQty = getDomain("pharma")?.fields.find((f) => f.id === "free_qty") as FieldDef;
    expect(scoreField(freeQty, col(p, "free sulfur dioxide")).score).toBeLessThan(MATCH_THRESHOLD);
  });

  it("asks which industry, matching none", () => {
    const detection = detectDomain([...DOMAINS], p);
    expect(detection.needsConfirmation).toBe(true);
    for (const c of detection.candidates) expect(c.evidence, c.domainId).toEqual([]);
  });

  it("still matches Grand Total, Net Amount, Total (₹) and Order Total", async () => {
    const rows = Array.from({ length: 80 }, (_, i) => [
      `INV-${5000 + i}`,
      (900 + i * 21.5).toFixed(2),
      (800 + i * 19.25).toFixed(2),
      (950 + i * 22.75).toFixed(2),
      (990 + i * 23.5).toFixed(2),
    ]);
    const sales = profileDataset(
      await parseCsv(
        csvOf(["Invoice No", "Grand Total", "Net Amount", "Total (₹)", "Order Total"], rows),
        "invoices",
      ),
    );
    // A money field with only generic synonyms: each column still clears the threshold, by its name or,
    // for "Order Total", because its profile says it is money.
    const total: FieldDef = {
      id: "total",
      label: "Bill total",
      roles: ["currency", "measure"],
      synonyms: ["total", "amount", "net amount"],
      weight: 2,
    };
    for (const name of ["Grand Total", "Net Amount", "Total (₹)", "Order Total"]) {
      expect(col(sales, name).role, name).toBe("currency");
      expect(scoreField(total, col(sales, name)).score, name).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
      const somewhere = DOMAINS.some((d: DomainDef) =>
        assignFields(d, sales.columns).some((a) => a.column === name),
      );
      expect(somewhere, `${name} matches a field in some industry`).toBe(true);
    }
    expect(scoreField(total, col(p, "total sulfur dioxide")).score).toBeLessThan(MATCH_THRESHOLD);
  });
});

// ---------------------------------------------------------------- the general dashboard

/** Pearson r of each characteristic with quality, strongest first, from the generator's own rows. */
function linkedToQuality(): Array<{ name: string; r: number }> {
  const q = Float64Array.from(WINES, (w) => w.quality);
  return HEADERS.filter((h) => h !== "quality")
    .map((h) => ({
      name: h as string,
      r: pearson(
        Float64Array.from(WINES, (w) => w[h]),
        q,
      ).r,
    }))
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}

describe("the general dashboard of a rated table", async () => {
  const s = new Session();
  const load = await s.ingest(new Blob([WINE_CSV]), "winequality-white.csv", {});
  if (load.status !== "ok") throw new Error(load.status);
  const ctx = s.configure({ domainId: "generic", numberLocale: "INTL", currency: null });
  const kpi = (name: string) => ctx.kpis.find((k) => k.name === name) as ContextResult["kpis"][number];
  const batch = s.kpiBatch(
    [],
    ctx.kpis.filter((k) => k.available).map((k) => k.id),
    "INTL",
  );
  const value = (name: string) => batch.values.find((v) => v.id === kpi(name)?.id)?.value;
  const linked = linkedToQuality();
  const top = linked[0] as { name: string; r: number };
  const qualities = WINES.map((w) => w.quality);

  it("says what the table is", () => {
    expect(ctx.domain.subDomains[0]?.name).toBe("Labelled table");
    expect(ctx.domain.description).toBe(
      `${ROWS} wines rated 3–9 on quality, with 11 measured characteristics`,
    );
    expect(ctx.grainLabel).toBe("One row per wine");
  });

  it("leads with wines, average quality, the share rated 7 or above and the characteristic that moves most with quality", () => {
    expect(top.name).toBe("alcohol");
    const hero = ctx.selection.hero.map((id) => ctx.kpis.find((k) => k.id === id)?.name);
    expect(hero).toEqual(["Wines", "Average quality", "Share rated 7 or above", "Average alcohol"]);
    expect(value("Wines")).toBe(ROWS);
    expect(value("Average quality")).toBeCloseTo(qualities.reduce((a, b) => a + b, 0) / ROWS, 12);
    expect(value("Share rated 7 or above")).toBeCloseTo(qualities.filter((q) => q >= 7).length / ROWS, 12);
    expect(value("Rated 7 or above")).toBe(qualities.filter((q) => q >= 7).length);
    expect(value("Average alcohol")).toBeCloseTo(WINES.reduce((a, w) => a + w.alcohol, 0) / ROWS, 9);
    // The threshold is named in the definition, and the link is quoted from the data.
    expect(kpi("Share rated 7 or above").definition).toMatch(/7 or above/);
    expect(kpi("Average alcohol").definition).toContain(`r = ${top.r.toFixed(2).replace("-", "−")}`);
  });

  it("charts the score distribution, what moves with it, a scatter and a table, in the scale's order", () => {
    const byId = new Map(ctx.charts.map((c) => [c.id, c]));
    const dist = s.chart([], { specId: "g_outcome_dist" }, "INTL");
    expect(byId.get("g_outcome_dist")?.title).toBe("Wines by quality");
    expect(dist?.categories.map((c) => c.label)).toEqual(["3", "4", "5", "6", "7", "8", "9"]);
    const counts = [3, 4, 5, 6, 7, 8, 9].map((q) => qualities.filter((x) => x === q).length);
    expect(dist?.series[0]?.values).toEqual(counts);
    const drivers = linked.slice(0, 3).map((x) => x.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase());
    for (const id of drivers) {
      const spec = byId.get(`g_outcome_${id}`);
      expect(spec?.kind, id).toBe("bar");
      const data = s.chart([], { specId: `g_outcome_${id}` }, "INTL");
      // Scores held by fewer than 5 wines are set aside; the rest read in order.
      const shown = data?.categories.map((c) => Number(c.label)) ?? [];
      expect(shown, id).toEqual([...shown].sort((a, b) => a - b));
    }
    expect(byId.get("g_outcome_alcohol")?.title).toBe("Average alcohol by quality");
    expect(byId.get("g_outcome_scatter")).toMatchObject({ kind: "scatter", title: "Alcohol vs quality" });
    expect(s.chart([], { specId: "g_outcome_scatter" }, "INTL")?.points?.length).toBeGreaterThan(5);
    const table = byId.get("g_outcome_table");
    expect(table?.kind).toBe("table");
    expect(table?.measures.map((m) => m.label)).toEqual(linked.slice(0, 4).map((x) => `Average ${x.name}`));
    expect(s.chart([], { specId: "g_outcome_table" }, "INTL")?.categories.map((c) => c.label)).toEqual([
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
    ]);
    for (const c of ctx.charts) expect(s.chart([], { specId: c.id }, "INTL")?.empty, c.id).toBe(false);
  });

  it("sums nothing, and every KPI compiles to SQL and DAX that DuckDB agrees with", async () => {
    const ec = (s as unknown as { exportContext(): ExportContext }).exportContext();
    for (const r of ec.res.values())
      if (r.available && r.variant) expect(sums(r.variant.expr), r.def.id).toBe(false);
    for (const k of ctx.kpis.filter((x) => x.available)) {
      expect(k.sql, `${k.id} SQL`).toBeTruthy();
      expect(k.dax, `${k.id} DAX`).toBeTruthy();
    }
    expect(await duckMismatches(s)).toEqual([]);
  });

  it("calls the rows rows when the file name doesn't say what they are", async () => {
    const t = new Session();
    const l = await t.ingest(new Blob([WINE_CSV]), "cleaned.csv", {});
    if (l.status !== "ok") throw new Error(l.status);
    const c = t.configure({ domainId: "generic", numberLocale: "INTL", currency: null });
    expect(c.domain.description).toBe(`${ROWS} rows rated 3–9 on quality, with 11 measured characteristics`);
    expect(c.kpis.find((k) => k.id === "records")?.name).toBe("Rows");
  });
});

// ---------------------------------------------------------------- an industry that doesn't fit

describe("an industry chosen for a table it doesn't fit", async () => {
  const s = new Session();
  const load = await s.ingest(new Blob([WINE_CSV]), "winequality-white.csv", {});
  if (load.status !== "ok") throw new Error(load.status);
  const ctx = s.configure({ domainId: "pharma", numberLocale: "INTL", currency: null });

  it("says it fits weakly", () => {
    expect(ctx.fit).toEqual({ mapped: 0, columns: HEADERS.length, weak: true });
    // Nothing is read as sales: no Pharma KPI reads a column of this file.
    for (const k of ctx.kpis.filter((x) => x.available && !x.id.startsWith("yc_")))
      expect(
        k.fieldsUsed.filter((f) => !f.fieldId.startsWith("col:")),
        k.id,
      ).toEqual([]);
  });

  it("fills the dashboard with the general charts, in a section of their own", () => {
    const fill = ctx.charts.filter((c) => c.id.startsWith("yc_g_"));
    expect(fill.length).toBeGreaterThanOrEqual(3);
    for (const c of fill) {
      expect(c.section, c.id).toBe("columns");
      expect(s.chart([], { specId: c.id }, "INTL")?.empty, c.id).toBe(false);
    }
    expect(fill.map((c) => c.title)).toContain("Wines by quality");
  });

  it("never says a general dashboard fits weakly, nor a demo its own industry", () => {
    expect(s.configure({ domainId: "generic", numberLocale: "INTL", currency: null }).fit.weak).toBe(false);
    for (const sample of SAMPLES) {
      const t = new Session();
      t.ingestSample(sample.id);
      const fit = t.configure({ domainId: sample.domain, numberLocale: "INTL", currency: null }).fit;
      expect(fit.weak, `${sample.id}: ${JSON.stringify(fit)}`).toBe(false);
    }
  });
});
