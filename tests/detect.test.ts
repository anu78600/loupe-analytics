/**
 * Detection accuracy suite: column roles, name matching and industry
 * detection on realistic file layouts.
 *
 * Every layout in fixtures/detection.json is a real tool's export header with
 * a handful of sample rows. expandFixture grows those rows into a
 * deterministic CSV (key columns stay unique, ID columns repeat from a pool,
 * numbers and dates are drawn within the sampled range and written in the
 * sampled format, everything else is redrawn from the samples), which is then
 * parsed, profiled and detected exactly as Session.adopt does: ingestFile →
 * profileDataset → detectDomain over the registry. The bundled demos go
 * through generateSample instead.
 *
 * A clear case must put the expected industry first without opening the
 * guided "please confirm" flow; an ambiguous one must open it (and, when the
 * fixture lists acceptable industries, rank one of them first). Regressions
 * for specific role and name-matching bugs sit alongside, and an accuracy
 * summary is printed after the run.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DAY_MS } from "@/engine/core/dates";
import type { Dataset } from "@/engine/core/types";
import { ingestFile } from "@/engine/parse";
import { profileDataset } from "@/engine/profile/profile";
import { nameSimilarity, tokenize } from "@/engine/profile/names";
import { detectWideFormat, wideKind } from "@/engine/profile/structure";
import type { ColumnProfile, DatasetProfile } from "@/engine/profile/types";
import { detectDomain, type DetectionResult } from "@/engine/detect/detect";
import { assignFields, MATCH_THRESHOLD, scoreField } from "@/engine/detect/match";
import { buildMapping } from "@/engine/detect/mapping";
import { generateSample, SAMPLES } from "@/engine/samples";
import { DOMAINS, getDomain } from "@/registry";
import type { DomainDef, FieldDef } from "@/registry/schema";

// ---------------------------------------------------------------- fixtures

interface Fixture {
  id: string;
  /** The tool or dataset the layout comes from. */
  source: string;
  /** Expected top industry; several ids when any of them is acceptable; null when no industry fits. */
  expect: string | string[] | null;
  /** Whether the guided "please confirm" flow should open. */
  confirm: boolean;
  /** Bundled demo id: the data comes from generateSample instead of headers and rows. */
  demo?: string;
  headers?: string[];
  rows?: string[][];
  /** Columns with a different value on every row (keys). */
  unique?: string[];
  /** Repeating ID columns, drawn from a pool large enough to profile as identifiers. */
  ids?: string[];
}

interface FixtureFile {
  description: string;
  rowCount: number;
  fixtures: Fixture[];
}

const FIXTURES = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "detection.json"), "utf8"),
) as FixtureFile;

/** Deterministic PRNG (mulberry32), seeded per fixture so every run builds the same files. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The sample value with its last run of digits advanced by `offset` (width kept); values without digits get a suffix. */
function withSerial(sample: string, offset: number): string {
  const m = /(\d+)(?!.*\d)/.exec(sample);
  if (!m) return sample.includes("@") ? sample.replace("@", `${offset}@`) : `${sample}-${offset}`;
  const digits = m[1] as string;
  const next = (BigInt(digits) + BigInt(offset)).toString().padStart(digits.length, "0");
  return sample.slice(0, m.index) + next + sample.slice(m.index + digits.length);
}

type Draw = (r: () => number) => string;

const NUMBER_RE = /^(₹|\$|€|£|Rs\.? ?)?(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%)?$/;

/** Numbers drawn uniformly within the sampled range, written with the sampled symbol, grouping and decimals. */
function numberDraw(values: readonly string[]): Draw | null {
  let prefix: string | null = null;
  let suffix = "";
  let decimals = 0;
  let grouped = false;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    const m = NUMBER_RE.exec(v);
    if (!m) return null;
    const int = m[3] as string;
    // A leading zero marks a code ("007"), not a quantity.
    if (int.length > 1 && int.startsWith("0")) return null;
    if (prefix === null) {
      prefix = m[1] ?? "";
      suffix = m[5] ?? "";
    } else if ((m[1] ?? "") !== prefix || (m[5] ?? "") !== suffix) return null;
    if (int.includes(",")) grouped = true;
    decimals = Math.max(decimals, (m[4] ?? "").length);
    const x = Number(`${m[2] ?? ""}${int.replace(/,/g, "")}.${m[4] ?? "0"}`);
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  const p = prefix ?? "";
  return (r) => {
    const x = min + r() * (max - min);
    let body = Math.abs(x).toFixed(decimals);
    if (grouped) {
      const [i, f] = body.split(".");
      body = `${(i as string).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${f === undefined ? "" : `.${f}`}`;
    }
    return `${p}${x < 0 ? "-" : ""}${body}${suffix}`;
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");

interface DateShape {
  parse(v: string): number | null;
  format(ms: number): string;
  hasTime: boolean;
}

/** ISO dates with an optional time ("T" or space), optional seconds and a fixed suffix (zone). */
function isoShape(first: string): DateShape | null {
  const re = /^(\d{4})-(\d{2})-(\d{2})(?:([T ])(\d{2}):(\d{2})(?::(\d{2}))?)?(.*)$/;
  const f = re.exec(first);
  if (!f || (f[8] !== "" && f[4] === undefined)) return null;
  const sep = f[4];
  const secs = f[7] !== undefined;
  const tail = f[8] as string;
  return {
    hasTime: sep !== undefined,
    parse(v) {
      const m = re.exec(v);
      if (!m || m[4] !== sep || (m[7] !== undefined) !== secs || m[8] !== tail) return null;
      return Date.UTC(
        +(m[1] as string),
        +(m[2] as string) - 1,
        +(m[3] as string),
        +(m[5] ?? 0),
        +(m[6] ?? 0),
        +(m[7] ?? 0),
      );
    },
    format(ms) {
      const d = new Date(ms);
      const day = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
      if (sep === undefined) return day;
      return `${day}${sep}${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}${secs ? `:${pad2(d.getUTCSeconds())}` : ""}${tail}`;
    },
  };
}

/** Numeric day/month/year dates; the order comes from the samples (a part above 12 decides, else day first). */
function numericShape(values: readonly string[]): DateShape | null {
  const re = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
  const ms = values.map((v) => re.exec(v));
  if (ms.some((m) => !m)) return null;
  const all = ms as RegExpExecArray[];
  const f = all[0] as RegExpExecArray;
  const sep = f[2] as string;
  const dayFirst = all.some((m) => +(m[1] as string) > 12) || !all.some((m) => +(m[3] as string) > 12);
  const padded = all.every((m) => (m[1] as string).length === 2 && (m[3] as string).length === 2);
  const year2 = (f[4] as string).length === 2;
  const time = f[5] !== undefined;
  const hourPadded = time && (f[5] as string).length === 2;
  const secs = f[7] !== undefined;
  return {
    hasTime: time,
    parse(v) {
      const m = re.exec(v);
      if (!m) return null;
      const a = +(m[1] as string);
      const b = +(m[3] as string);
      const y = +(m[4] as string) + (year2 ? 2000 : 0);
      return Date.UTC(y, (dayFirst ? b : a) - 1, dayFirst ? a : b, +(m[5] ?? 0), +(m[6] ?? 0), +(m[7] ?? 0));
    },
    format(ms) {
      const d = new Date(ms);
      const day = padded ? pad2(d.getUTCDate()) : String(d.getUTCDate());
      const mon = padded ? pad2(d.getUTCMonth() + 1) : String(d.getUTCMonth() + 1);
      const y = year2 ? pad2(d.getUTCFullYear() % 100) : String(d.getUTCFullYear());
      const date = dayFirst ? `${day}${sep}${mon}${sep}${y}` : `${mon}${sep}${day}${sep}${y}`;
      if (!time) return date;
      const h = hourPadded ? pad2(d.getUTCHours()) : String(d.getUTCHours());
      return `${date} ${h}:${pad2(d.getUTCMinutes())}${secs ? `:${pad2(d.getUTCSeconds())}` : ""}`;
    },
  };
}

/** "1-Apr-24" / "15 Mar 2024" style dates. */
function dayMonShape(first: string): DateShape | null {
  const re = /^(\d{1,2})([- ])([A-Za-z]{3})\2(\d{4}|\d{2})$/;
  const f = re.exec(first);
  if (!f) return null;
  const sep = f[2] as string;
  const year2 = (f[4] as string).length === 2;
  return {
    hasTime: false,
    parse(v) {
      const m = re.exec(v);
      const mon = m ? MONTHS.findIndex((x) => x.toLowerCase() === (m[3] as string).toLowerCase()) : -1;
      if (!m || mon < 0) return null;
      return Date.UTC(+(m[4] as string) + (year2 ? 2000 : 0), mon, +(m[1] as string));
    },
    format(ms) {
      const d = new Date(ms);
      const y = year2 ? pad2(d.getUTCFullYear() % 100) : String(d.getUTCFullYear());
      return `${d.getUTCDate()}${sep}${MONTHS[d.getUTCMonth()]}${sep}${y}`;
    },
  };
}

/** Dates drawn uniformly between the sampled minimum and maximum, written in the sampled layout. */
function dateDraw(values: readonly string[]): Draw | null {
  const first = values[0] as string;
  for (const shape of [isoShape(first), numericShape(values), dayMonShape(first)]) {
    if (!shape) continue;
    const ms = values.map((v) => shape.parse(v));
    if (ms.some((x) => x === null || Number.isNaN(x))) continue;
    const lo = Math.min(...(ms as number[]));
    const hi = Math.max(...(ms as number[]));
    return (r) => {
      if (shape.hasTime) return shape.format(lo + Math.floor(r() * ((hi - lo) / 1000 + 1)) * 1000);
      return shape.format(lo + Math.floor(r() * ((hi - lo) / DAY_MS + 1)) * DAY_MS);
    };
  }
  return null;
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * Builds the fixture's CSV: the sample rows first (key columns renumbered),
 * then generated rows up to `rowCount`. Blank samples keep their share of
 * blanks in generated rows.
 */
function expandFixture(f: Fixture, rowCount: number): string {
  const headers = f.headers ?? [];
  const rows = f.rows ?? [];
  const r = rng(seedOf(f.id));
  const pool = Math.max(60, Math.round(rowCount / 3));
  const columns = headers.map((h, j) => {
    const samples = rows.map((row) => row[j] ?? "");
    const filled = samples.filter((v) => v.trim() !== "");
    const blankShare = 1 - filled.length / Math.max(1, samples.length);
    const base = filled[0] ?? "";
    let draw: Draw;
    if (f.ids?.includes(h)) draw = (rr) => withSerial(base, Math.floor(rr() * pool));
    else
      draw =
        (filled.length && (numberDraw(filled) ?? dateDraw(filled))) ||
        ((rr) => filled[Math.floor(rr() * filled.length)] ?? "");
    return { unique: f.unique?.includes(h) ?? false, base, samples, blankShare, draw };
  });
  const lines = [headers.map(csvCell).join(",")];
  for (let i = 0; i < rowCount; i++) {
    const cells = columns.map((c) => {
      if (c.unique) return withSerial(c.base, i);
      if (i < rows.length) return c.samples[i] as string;
      if (c.blankShare > 0 && r() < c.blankShare) return "";
      return c.draw(r);
    });
    lines.push(cells.map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function parseCsv(csv: string, name: string): Promise<Dataset> {
  const out = await ingestFile(new Blob([csv]), `${name}.csv`, {});
  if (out.status !== "ok") throw new Error(`${name}: expected a dataset, got ${out.status}`);
  return out.dataset;
}

/** Same steps as Session.adopt: profile, then detect over every registry domain. */
function detect(ds: Dataset): { profile: DatasetProfile; detection: DetectionResult } {
  const profile = profileDataset(ds);
  return { profile, detection: detectDomain([...DOMAINS], profile) };
}

interface Outcome {
  fixture: Fixture;
  detection: DetectionResult;
  topOk: boolean | null;
  confirmOk: boolean;
}

const acceptable = (f: Fixture): string[] | null =>
  f.expect === null ? null : Array.isArray(f.expect) ? f.expect : [f.expect];

const outcomes = new Map<string, Outcome>();

beforeAll(async () => {
  for (const f of FIXTURES.fixtures) {
    const ds = f.demo ? generateSample(f.demo) : await parseCsv(expandFixture(f, FIXTURES.rowCount), f.id);
    const { detection } = detect(ds);
    const want = acceptable(f);
    const top = detection.candidates[0]?.domainId;
    outcomes.set(f.id, {
      fixture: f,
      detection,
      topOk: want ? top !== undefined && want.includes(top) : null,
      confirmOk: detection.needsConfirmation === f.confirm,
    });
  }
});

afterAll(() => {
  const all = [...outcomes.values()];
  if (!all.length) return;
  const judged = all.filter((o) => o.topOk !== null);
  const top1 = judged.filter((o) => o.topOk).length;
  const conf = all.filter((o) => o.confirmOk).length;
  const both = all.filter((o) => o.confirmOk && o.topOk !== false).length;
  const pct = (a: number, b: number) => `${a}/${b} (${((a / Math.max(1, b)) * 100).toFixed(1)}%)`;
  const lines = [
    `Detection accuracy over ${all.length} layouts: top-1 ${pct(top1, judged.length)} · confirmation ${pct(conf, all.length)} · fully correct ${pct(both, all.length)}`,
  ];
  for (const o of all) {
    const want = acceptable(o.fixture);
    const got = o.detection.candidates.map((c) => `${c.domainId} ${c.confidence}`).join(" · ");
    const ok = o.topOk !== false && o.confirmOk;
    lines.push(
      `${ok ? "  ok  " : "  FAIL"} ${o.fixture.id.padEnd(30)} want ${(want ? want.join("|") : "(none)").padEnd(22)} ask ${o.fixture.confirm ? "yes" : "no "} | got ${got.padEnd(48)} ask ${o.detection.needsConfirmation ? "yes" : "no"}`,
    );
  }
  // Written to stdout rather than console.info, which this Vitest setup hides when every test passes.
  process.stdout.write(`${lines.join("\n")}\n`);
});

describe("industry detection on real-world layouts", () => {
  it("has a sane fixture file", () => {
    expect(FIXTURES.fixtures.length).toBeGreaterThanOrEqual(55);
    const covered = new Set(FIXTURES.fixtures.flatMap((f) => acceptable(f) ?? []));
    for (const d of DOMAINS) expect(covered.has(d.id), `no fixture for ${d.id}`).toBe(true);
    for (const f of FIXTURES.fixtures) {
      if (f.demo) continue;
      const width = f.headers?.length ?? 0;
      expect(width, f.id).toBeGreaterThan(0);
      for (const row of f.rows ?? []) expect(row.length, `${f.id}: row width`).toBe(width);
      for (const c of [...(f.unique ?? []), ...(f.ids ?? [])])
        expect(f.headers, `${f.id}: ${c}`).toContain(c);
    }
  });

  it("covers every bundled demo", () => {
    const demos = new Set(FIXTURES.fixtures.map((f) => f.demo).filter(Boolean));
    for (const s of SAMPLES) expect(demos.has(s.id), s.id).toBe(true);
  });

  it.each(FIXTURES.fixtures.map((f) => [f.id, f] as const))("%s", (_id, f) => {
    const o = outcomes.get(f.id) as Outcome;
    const top = o.detection.candidates[0];
    const summary = `${o.detection.candidates.map((c) => `${c.domainId} ${c.confidence}`).join(", ")}; ${o.detection.reason}`;
    const want = acceptable(f);
    if (want) expect(want, summary).toContain(top?.domainId);
    expect(o.detection.needsConfirmation, summary).toBe(f.confirm);
  });

  it("detects every demo without asking", () => {
    for (const s of SAMPLES) {
      const { detection } = detect(generateSample(s.id));
      expect(detection.candidates[0]?.domainId, s.id).toBe(s.domain);
      expect(detection.needsConfirmation, `${s.id}: ${detection.reason}`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- role regressions

/** Parses a small CSV built from columns of values and profiles it. */
async function profileOf(cols: Record<string, readonly (string | number)[]>): Promise<DatasetProfile> {
  const names = Object.keys(cols);
  const n = Math.max(...names.map((k) => (cols[k] as readonly unknown[]).length));
  const lines = [names.map(csvCell).join(",")];
  for (let i = 0; i < n; i++)
    lines.push(
      names.map((k) => csvCell(String((cols[k] as readonly (string | number)[])[i] ?? ""))).join(","),
    );
  return profileDataset(await parseCsv(`${lines.join("\n")}\n`, "roles"));
}

const col = (p: DatasetProfile, name: string): ColumnProfile => {
  const c = p.columns.find((x) => x.name === name);
  if (!c) throw new Error(`no column ${name}`);
  return c;
};

const seq = (n: number, f: (i: number) => string | number) => Array.from({ length: n }, (_, i) => f(i));

describe("column roles", () => {
  it("treats an hour of day as a time attribute, not a quantity to sum", async () => {
    const p = await profileOf({
      "Order Hour": seq(120, (i) => i % 24),
      incident_hour_of_the_day: seq(120, (i) => (i * 7) % 24),
      "Training Hours": seq(120, (i) => (i * 5) % 21),
      Amount: seq(120, (i) => 100 + i * 3.5),
    });
    for (const name of ["Order Hour", "incident_hour_of_the_day"]) {
      expect(col(p, name).role, name).toBe("dimension");
      expect(col(p, name).defaultAgg, name).not.toBe("sum");
    }
    // Hours as a duration are still a summable quantity.
    expect(col(p, "Training Hours").role).toBe("measure");
    expect(col(p, "Training Hours").defaultAgg).toBe("sum");
  });

  it("sums a Leads count but averages a lead time", async () => {
    const p = await profileOf({
      Leads: seq(90, (i) => (i * 13) % 300),
      "Lead Time (days)": seq(90, (i) => (i * 3) % 60),
      lead_time: seq(90, (i) => (i * 11) % 365),
    });
    expect(col(p, "Leads").role).toBe("measure");
    expect(col(p, "Leads").additivity).toBe("additive");
    expect(col(p, "Leads").defaultAgg).toBe("sum");
    for (const name of ["Lead Time (days)", "lead_time"]) {
      expect(col(p, name).additivity, name).toBe("non-additive");
      expect(col(p, name).defaultAgg, name).toBe("avg");
    }
  });

  it("keeps a spend column in the Excel-serial range as money, end to end", async () => {
    // Every "Ad Spend" value lies in 20,000–80,000, where a date-named column would be read as Excel dates.
    const f = FIXTURES.fixtures.find((x) => x.id === "marketing-mis-ad-spend") as Fixture;
    const p = profileDataset(await parseCsv(expandFixture(f, FIXTURES.rowCount), f.id));
    expect(col(p, "Ad Spend").storage).toBe("number");
    expect(col(p, "Ad Spend").role).toBe("currency");
    expect(col(p, "Leads").defaultAgg).toBe("sum");
  });

  it("reads a Margin % stored as points as a percentage, not money", async () => {
    const p = await profileOf({
      "Margin %": seq(80, (i) => (5 + ((i * 7) % 40) + 0.5).toFixed(1)),
      "Gross Margin": seq(80, (i) => 1000 + i * 250.75),
    });
    const m = col(p, "Margin %");
    expect(m.role).toBe("percentage");
    expect(m.percentScale).toBe(100);
    expect(m.defaultAgg).toBe("avg");
    expect(col(p, "Gross Margin").role).toBe("currency");
  });

  it("never makes a unique measure the primary key", async () => {
    const regions = ["North", "South", "East", "West"];
    const noId = await profileOf({
      Date: seq(60, (i) => `2024-01-${pad2((i % 28) + 1)}`),
      Region: seq(60, (i) => regions[i % 4] as string),
      Amount: seq(60, (i) => (1000 + i * 17.31).toFixed(2)),
    });
    expect(noId.keys.primary).not.toEqual(["Amount"]);
    expect(noId.keys.candidates.flat()).not.toContain("Amount");
    expect(noId.grain.description.toLowerCase()).not.toContain("amount");
    const withId = await profileOf({
      "Invoice No": seq(60, (i) => `INV-${1000 + i}`),
      Amount: seq(60, (i) => (1000 + i * 17.31).toFixed(2)),
    });
    expect(withId.keys.primary).toEqual(["Invoice No"]);
  });

  it("reads OR, UT and CT in a state-code column as US states", async () => {
    const us = ["CA", "NY", "TX", "OR", "UT", "CT", "WA", "FL", "IL", "OR", "UT", "CT"];
    const p = await profileOf({
      State: seq(96, (i) => us[i % us.length] as string),
      Sales: seq(96, (i) => 10 + i),
    });
    expect(col(p, "State").role).toBe("geo");
    expect(col(p, "State").geoRegion).toBe("US");
    const india = ["Maharashtra", "Karnataka", "Odisha", "Uttarakhand", "Chhattisgarh", "Tamil Nadu"];
    const q = await profileOf({
      State: seq(96, (i) => india[i % india.length] as string),
      Sales: seq(96, (i) => 10 + i),
    });
    expect(col(q, "State").geoRegion).toBe("IN");
  });

  it("reads fused ALL-CAPS IDs, explicit quantities and segments correctly", async () => {
    const p = await profileOf({
      ORDERNUMBER: seq(80, (i) => 10100 + i),
      "Quantity (- Refund)": seq(80, (i) => (i % 5) + 1),
      "Market Segment": seq(80, (i) => ["Online TA", "Direct", "Corporate"][i % 3] as string),
      Market: seq(80, (i) => ["APAC", "EMEA", "LATAM"][i % 3] as string),
    });
    expect(col(p, "ORDERNUMBER").role).toBe("identifier");
    expect(col(p, "Quantity (- Refund)").role).toBe("measure");
    expect(col(p, "Market Segment").role).toBe("dimension");
    expect(col(p, "Market").role).toBe("geo");
  });

  it("does not mistake words like Market or Junior for month columns", async () => {
    for (const w of ["Market", "Marketing", "Junior", "Decimal", "Octane", "Augment", "Mayor"])
      expect(wideKind(w), w).toBeNull();
    for (const w of ["Jan", "January 2024", "Mar-25", "Sept", "Sep 2024", "Dec'23", "June"])
      expect(wideKind(w), w).toBe("month");
    const p = await profileOf({
      Product: seq(30, (i) => `P${i}`),
      Market: seq(30, (i) => i),
      Junior: seq(30, (i) => i * 2),
      Marketing: seq(30, (i) => i * 3),
    });
    expect(detectWideFormat(p.columns)).toBeNull();
  });
});

// ---------------------------------------------------------------- name matching

const fieldOf = (domainId: string, fieldId: string): FieldDef => {
  const f = getDomain(domainId)?.fields.find((x) => x.id === fieldId);
  if (!f) throw new Error(`no field ${domainId}.${fieldId}`);
  return f;
};

/** The registry field without its exclude list, to prove the matcher itself rejects the pair. */
const bare = (f: FieldDef): FieldDef => ({ ...f, exclude: undefined });

describe("name matching", () => {
  let p: DatasetProfile;
  beforeAll(async () => {
    p = await profileOf({
      injury_claim: seq(80, (i) => 500 + i * 37),
      "Market Rent": seq(80, (i) => 1200 + i * 11),
      MultipleLines: seq(80, (i) => ["Yes", "No", "No phone service"][i % 3] as string),
      "Updated at": seq(80, (i) => `2024-03-${pad2((i % 28) + 1)} 10:${pad2(i % 60)}`),
      is_fraud: seq(80, (i) => (i % 9 === 0 ? 1 : 0)),
      is_active: seq(80, (i) => (i % 3 === 0 ? 0 : 1)),
      Loan_Status: seq(80, (i) => ["Fully Paid", "Charged Off", "Current"][i % 3] as string),
    });
  });

  it("needs more than one shared word for a partial match", () => {
    const pairs: Array<[string, string]> = [
      ["injury_claim", "claim paid"],
      ["Market Rent", "market value"],
      ["MultipleLines", "line id"],
      ["MultipleLines", "product line"],
      ["Updated at", "responded at"],
      ["is_fraud", "is default"],
      ["Loan_Status", "bad loan"],
      ["Date of Birth", "date of joining"],
      ["Days for shipping (real)", "days for shipment (scheduled)"],
    ];
    for (const [column, synonym] of pairs)
      expect(nameSimilarity(tokenize(column), synonym), `${column} ~ ${synonym}`).toBeLessThan(
        MATCH_THRESHOLD,
      );
  });

  it("rejects the listed mis-mappings without relying on exclude lists", () => {
    const cases: Array<[string, string, string]> = [
      ["injury_claim", "insurance", "paid_amount"],
      ["Market Rent", "real_estate", "property_value"],
      ["MultipleLines", "telecom", "plan_type"],
      ["MultipleLines", "telecom", "subscriber_id"],
      ["Updated at", "support", "first_response_at"],
    ];
    for (const [column, domain, field] of cases) {
      expect(
        scoreField(bare(fieldOf(domain, field)), col(p, column)).score,
        `${column} → ${domain}.${field}`,
      ).toBeLessThan(MATCH_THRESHOLD);
    }
    const isDefault: FieldDef = {
      id: "default_flag",
      label: "Default flag",
      roles: ["boolean"],
      synonyms: ["is default"],
      weight: 1.5,
    };
    for (const column of ["is_fraud", "is_active"])
      expect(scoreField(isDefault, col(p, column)).score, column).toBeLessThan(MATCH_THRESHOLD);
    const badLoan: FieldDef = {
      id: "default_flag",
      label: "Default flag",
      roles: ["boolean", "dimension"],
      synonyms: ["bad loan"],
      weight: 1.5,
    };
    expect(scoreField(badLoan, col(p, "Loan_Status")).score).toBeLessThan(MATCH_THRESHOLD);
  });

  it("does not assign those columns in the registry either", () => {
    const assigned = (domain: string) =>
      new Map(assignFields(getDomain(domain) as DomainDef, p.columns).map((a) => [a.column, a.fieldId]));
    expect(assigned("insurance").get("injury_claim")).not.toBe("paid_amount");
    expect(assigned("real_estate").get("Market Rent")).not.toBe("property_value");
    expect(assigned("telecom").get("MultipleLines")).toBeUndefined();
    expect(assigned("support").get("Updated at")).toBeUndefined();
  });

  it("still matches real-world spellings", () => {
    const good: Array<[string, string]> = [
      ["Total Quantity", "quantity"],
      ["Weight (KG)", "weight"],
      ["Amount spent (INR)", "amount spent"],
      ["Date of Admission", "admission date"],
      ["Time to First Response", "first response time"],
      ["Order Item Quantity", "order quantity"],
      ["CUSTOMERNAME", "customer name"],
      ["Fulfillment Status", "fulfilment status"],
      ["Created", "created at"],
    ];
    for (const [column, synonym] of good)
      expect(nameSimilarity(tokenize(column), synonym), `${column} ~ ${synonym}`).toBeGreaterThanOrEqual(0.7);
  });

  it("keeps a one-word synonym weak on a column that adds a distinctive word", () => {
    // Still a match, but weak: a synonym naming the whole phrase wins the column.
    for (const [column, synonym] of [
      ["Freight Cost", "cost"],
      ["Customer Country", "customer"],
      ["Campaign status", "status"],
    ] as const) {
      const s = nameSimilarity(tokenize(column), synonym);
      expect(s, `${column} ~ ${synonym}`).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
      expect(s, `${column} ~ ${synonym}`).toBeLessThan(
        nameSimilarity(tokenize(column), column.toLowerCase()),
      );
      expect(s, `${column} ~ ${synonym}`).toBeLessThanOrEqual(0.6);
    }
    expect(nameSimilarity(tokenize("Gross Amount"), "amount")).toBeGreaterThanOrEqual(0.85);
  });

  it("normalises names consistently", () => {
    expect(tokenize("Pin Code")).toEqual(["pincode"]);
    expect(tokenize("PIN")).toEqual(["pincode"]);
    expect(tokenize("E-mail")).toEqual(["email"]);
    expect(tokenize("Sub Cat")).toEqual(["subcategory"]);
    expect(tokenize("TV Series")).toEqual(["tv", "series"]);
    expect(tokenize("Categories")).toEqual(["category"]);
    expect(tokenize("Movies")).toEqual(["movie"]);
  });

  it("only applies an exclude token the matched synonym lacks", () => {
    const f: FieldDef = {
      id: "order_date",
      label: "Order date",
      roles: ["datetime"],
      synonyms: ["order date", "date", "ship window date"],
      exclude: ["ship"],
      weight: 3,
    };
    const q = p.columns.find((c) => c.name === "Updated at") as ColumnProfile;
    const asNamed = (name: string): ColumnProfile => ({ ...q, name, tokens: tokenize(name) });
    // "Ship Date" fully matches only "date", which lacks the excluded token: penalised.
    expect(scoreField(f, asNamed("Ship Date")).score).toBeLessThan(MATCH_THRESHOLD);
    // "Ship Window Date" is a synonym that names the token itself: not penalised.
    expect(scoreField(f, asNamed("Ship Window Date")).score).toBeGreaterThanOrEqual(0.9);
  });

  it("drops the score of a field whose column was taken by an override", () => {
    const d = getDomain("ecommerce") as DomainDef;
    const prof = { ...p, columns: [...p.columns] };
    const mapping = buildMapping(
      d,
      prof,
      [{ fieldId: "net_amount", column: "Market Rent", score: 0.8, via: "name" }],
      { fields: { gross_amount: "Market Rent" } },
    );
    expect(mapping.fields.gross_amount).toBe("Market Rent");
    expect(mapping.fields.net_amount).toBeUndefined();
    expect(mapping.scores.net_amount).toBeUndefined();
    expect(mapping.scores.gross_amount).toBe(1);
  });
});
