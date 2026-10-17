/**
 * Real-world table layouts as test files. A layout is a tool's export header
 * with a handful of sample rows; expandFixture grows it into a deterministic
 * CSV (key columns stay unique, ID columns repeat from a pool, numbers and
 * dates are drawn within the sampled range and written in the sampled format,
 * everything else is redrawn from the samples), and detect() runs the same
 * steps as Session.adopt: profileDataset, then detectDomain over the registry.
 *
 * Shared by the detection suite (tests/detect.test.ts) and the real-world
 * benchmark (tests/benchmark.test.ts).
 */
import { DAY_MS } from "@/engine/core/dates";
import type { Dataset } from "@/engine/core/types";
import { ingestFile } from "@/engine/parse";
import { profileDataset } from "@/engine/profile/profile";
import type { DatasetProfile } from "@/engine/profile/types";
import { detectDomain, type DetectionResult } from "@/engine/detect/detect";
import { DOMAINS } from "@/registry";

/** What expandFixture needs from a layout. */
export interface LayoutSpec {
  id: string;
  headers?: string[];
  rows?: string[][];
  /** Columns with a different value on every row (keys). */
  unique?: string[];
  /** Repeating ID columns, drawn from a pool large enough to profile as identifiers. */
  ids?: string[];
}

/** Deterministic PRNG (mulberry32), seeded per fixture so every run builds the same files. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(s: string): number {
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
export const pad2 = (n: number) => String(n).padStart(2, "0");

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

const MONTH_INDEX = (name: string): number => {
  const k = name.slice(0, 3).toLowerCase();
  return MONTHS.findIndex((m) => m.toLowerCase() === k);
};
const FULL_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Further layouts real tools write: "14/Oct/26 9:42 AM" (Jira), "12-Mar-2024
 * 10:15", "Mar 12, 2024" and "March 12, 2024", "2024/03/12", compact
 * "20240312" (GA4), and month labels without a day ("Apr-24", "Apr 2024",
 * "January, 2024"), which are drawn as whole months.
 */
function moreShapes(values: readonly string[]): DateShape[] {
  const first = values[0] as string;
  const shapes: DateShape[] = [];
  const dayMonTime = /^(\d{1,2})([-/ ])([A-Za-z]{3})\2(\d{4}|\d{2}) (\d{1,2}):(\d{2})(?: ?([AP]M))?$/i.exec(
    first,
  );
  if (dayMonTime) {
    const re = /^(\d{1,2})([-/ ])([A-Za-z]{3})\2(\d{4}|\d{2}) (\d{1,2}):(\d{2})(?: ?([AP]M))?$/i;
    const sep = dayMonTime[2] as string;
    const year2 = (dayMonTime[4] as string).length === 2;
    const ampm = dayMonTime[7] !== undefined;
    shapes.push({
      hasTime: true,
      parse(v) {
        const m = re.exec(v);
        if (!m || MONTH_INDEX(m[3] as string) < 0) return null;
        let h = +(m[5] as string) % (ampm ? 12 : 24);
        if (ampm && (m[7] as string).toUpperCase() === "PM") h += 12;
        return Date.UTC(
          +(m[4] as string) + (year2 ? 2000 : 0),
          MONTH_INDEX(m[3] as string),
          +(m[1] as string),
          h,
          +(m[6] as string),
        );
      },
      format(ms) {
        const d = new Date(ms);
        const y = year2 ? pad2(d.getUTCFullYear() % 100) : String(d.getUTCFullYear());
        const hh = d.getUTCHours();
        const time = ampm
          ? `${hh % 12 === 0 ? 12 : hh % 12}:${pad2(d.getUTCMinutes())} ${hh < 12 ? "AM" : "PM"}`
          : `${pad2(hh)}:${pad2(d.getUTCMinutes())}`;
        return `${pad2(d.getUTCDate())}${sep}${MONTHS[d.getUTCMonth()]}${sep}${y} ${time}`;
      },
    });
  }
  const monDay = /^([A-Za-z]{3,9}) (\d{1,2}), (\d{4})$/;
  const md = monDay.exec(first);
  if (md) {
    const full = (md[1] as string).length > 3;
    shapes.push({
      hasTime: false,
      parse(v) {
        const m = monDay.exec(v);
        return m && MONTH_INDEX(m[1] as string) >= 0
          ? Date.UTC(+(m[3] as string), MONTH_INDEX(m[1] as string), +(m[2] as string))
          : null;
      },
      format(ms) {
        const d = new Date(ms);
        const mon = (full ? FULL_MONTHS : MONTHS)[d.getUTCMonth()];
        return `${mon} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
      },
    });
  }
  const ymdSlash = /^(\d{4})\/(\d{2})\/(\d{2})$/;
  if (ymdSlash.test(first))
    shapes.push({
      hasTime: false,
      parse(v) {
        const m = ymdSlash.exec(v);
        return m ? Date.UTC(+(m[1] as string), +(m[2] as string) - 1, +(m[3] as string)) : null;
      },
      format(ms) {
        const d = new Date(ms);
        return `${d.getUTCFullYear()}/${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}`;
      },
    });
  const compact = /^((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
  if (compact.test(first))
    shapes.push({
      hasTime: false,
      parse(v) {
        const m = compact.exec(v);
        return m ? Date.UTC(+(m[1] as string), +(m[2] as string) - 1, +(m[3] as string)) : null;
      },
      format(ms) {
        const d = new Date(ms);
        return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
      },
    });
  const monYear = /^([A-Za-z]{3,9})(-| |, )(\d{4}|\d{2})$/;
  const my = monYear.exec(first);
  if (my) {
    const full = (my[1] as string).length > 3;
    const sep = my[2] as string;
    const year2 = (my[3] as string).length === 2;
    shapes.push({
      hasTime: false,
      parse(v) {
        const m = monYear.exec(v);
        return m && MONTH_INDEX(m[1] as string) >= 0
          ? Date.UTC(+(m[3] as string) + (year2 ? 2000 : 0), MONTH_INDEX(m[1] as string), 1)
          : null;
      },
      format(ms) {
        const d = new Date(ms);
        const y = year2 ? pad2(d.getUTCFullYear() % 100) : String(d.getUTCFullYear());
        return `${(full ? FULL_MONTHS : MONTHS)[d.getUTCMonth()]}${sep}${y}`;
      },
    });
  }
  return shapes;
}

/** Compact dates ("20240312") look like numbers, so they are recognised before numbers are. */
const isCompactDate = (values: readonly string[]) =>
  values.length > 0 &&
  values.every((v) => /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(v));

/** Currency marks a number may carry before it, and units after it. */
const LOCAL_PREFIX = /^(?:[₹$€£¥]|Rs\.?|R\$|S\$|A\$|INR|USD|EUR|GBP|AED|SAR|BRL|CHF)? ?$/;
const LOCAL_SUFFIX = /^ ?(?:%|[₹€£]|[A-Za-z]{1,6}\.?)?$/;
const LOCAL_RE = /^(.*?)([(\-−]?)(\d[\d.,\s  ]*\d|\d)(\)?)(\D*)$/;

/**
 * Numbers in the local formats the reader above leaves alone: Indian lakh
 * grouping (₹12,45,600), decimal commas with dot, space or no grouping
 * (4.800,00, 1 234,56, 68400,00), negatives in brackets ((1,250.00)), and a
 * currency mark or unit around them ("EUR 1.200,00", "14.5 Lacs"). Drawn in
 * the sampled range and written back the same way.
 */
function localNumberDraw(values: readonly string[]): Draw | null {
  const parts: Array<{ pre: string; neg: boolean; body: string; suf: string; paren: boolean }> = [];
  for (const v of values) {
    const m = LOCAL_RE.exec(v.trim());
    if (!m) return null;
    const [, pre = "", sign = "", body = "", close = "", suf = ""] = m;
    if ((sign === "(") !== (close === ")")) return null;
    if (!LOCAL_PREFIX.test(pre) || !LOCAL_SUFFIX.test(suf)) return null;
    parts.push({ pre, neg: sign !== "", body, suf, paren: sign === "(" });
  }
  const first = parts[0];
  if (!first || parts.some((p) => p.pre !== first.pre || p.suf !== first.suf)) return null;
  const commaDecimal = parts.some(
    (p) =>
      /,\d{1,2}$/.test(p.body) || (p.body.includes(".") && p.body.lastIndexOf(",") > p.body.lastIndexOf(".")),
  );
  const decSep = commaDecimal ? "," : ".";
  const groupRe = commaDecimal ? /[.\s  ]/ : /[,\s  ]/;
  let group = "";
  let indian = false;
  let decimals = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const p of parts) {
    const pieces = p.body.split(decSep);
    if (pieces.length > 2) return null;
    const int = pieces[0] as string;
    const frac = pieces[1] ?? "";
    const groups = int.split(new RegExp(groupRe.source, "g"));
    if (groups.length > 1) {
      group = (groupRe.exec(int) as RegExpExecArray)[0];
      if (groups.length > 2 && groups.slice(1, -1).every((g) => g.length === 2)) indian = true;
    }
    const digits = groups.join("");
    // A leading zero marks a code ("007"), not a quantity.
    if (!/^\d+$/.test(digits) || !/^\d*$/.test(frac) || (digits.length > 1 && digits.startsWith("0")))
      return null;
    decimals = Math.max(decimals, frac.length);
    const x = Number(`${digits}.${frac || "0"}`) * (p.neg ? -1 : 1);
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  const brackets = parts.some((p) => p.paren);
  return (r) => {
    const x = min + r() * (max - min);
    const [i = "", f] = Math.abs(x).toFixed(decimals).split(".");
    let int = i;
    if (group && indian && i.length > 3)
      int = `${i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, group)}${group}${i.slice(-3)}`;
    else if (group) int = i.replace(/\B(?=(\d{3})+(?!\d))/g, group);
    const body = f === undefined ? int : `${int}${decSep}${f}`;
    const neg = x < 0;
    return `${first.pre}${neg ? (brackets ? "(" : "-") : ""}${body}${neg && brackets ? ")" : ""}${first.suf}`;
  };
}

/** Dates drawn uniformly between the sampled minimum and maximum, written in the sampled layout. */
function dateDraw(values: readonly string[]): Draw | null {
  const first = values[0] as string;
  for (const shape of [isoShape(first), numericShape(values), dayMonShape(first), ...moreShapes(values)]) {
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

export const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * Builds the fixture's CSV: the sample rows first (key columns renumbered),
 * then generated rows up to `rowCount`. Blank samples keep their share of
 * blanks in generated rows.
 */
export function expandFixture(f: LayoutSpec, rowCount: number): string {
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
        (filled.length &&
          ((isCompactDate(filled) ? dateDraw(filled) : null) ??
            numberDraw(filled) ??
            dateDraw(filled) ??
            localNumberDraw(filled))) ||
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

export async function parseCsv(csv: string, name: string): Promise<Dataset> {
  const out = await ingestFile(new Blob([csv]), `${name}.csv`, {});
  if (out.status !== "ok") throw new Error(`${name}: expected a dataset, got ${out.status}`);
  return out.dataset;
}

/** Same steps as Session.adopt: profile, then detect over every registry domain. */
export function detect(ds: Dataset): { profile: DatasetProfile; detection: DetectionResult } {
  const profile = profileDataset(ds);
  return { profile, detection: detectDomain([...DOMAINS], profile) };
}
