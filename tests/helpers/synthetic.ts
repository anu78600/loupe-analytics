/** Deterministic synthetic datasets built from a registry domain's field list (for contract tests). */
import type {
  BooleanColumn,
  Column,
  Dataset,
  DateColumn,
  NumberColumn,
  StringColumn,
} from "@/engine/core/types";
import { Rng } from "@/engine/core/random";
import { DAY_MS, utc } from "@/engine/core/dates";
import type { DomainDef, FieldDef } from "@/registry/schema";
import { resolveClassesForField, type Mapping } from "@/engine/detect/mapping";

const STATES = [
  "Maharashtra",
  "Karnataka",
  "Delhi",
  "Tamil Nadu",
  "Uttar Pradesh",
  "Gujarat",
  "West Bengal",
  "Telangana",
];
const CATS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];

function stringCol(name: string, values: string[]): StringColumn {
  const dict: string[] = [];
  const index = new Map<string, number>();
  const codes = new Int32Array(values.length);
  values.forEach((v, i) => {
    let c = index.get(v);
    if (c === undefined) {
      c = dict.length;
      index.set(v, c);
      dict.push(v);
    }
    codes[i] = c;
  });
  return { kind: "string", name, codes, dict };
}

const titleCase = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());

function generateField(
  f: FieldDef,
  domain: DomainDef,
  n: number,
  rng: Rng,
  base: Float64Array,
  idIndex: number,
): Column {
  const roles = f.roles;
  if (roles[0] === "datetime" || (roles.includes("datetime") && roles.length === 1)) {
    const values = new Float64Array(n);
    const offset = rng.int(0, 3);
    for (let i = 0; i < n; i++)
      values[i] = (base[i] as number) + (offset + rng.int(0, 6)) * DAY_MS + rng.int(0, 23) * 3_600_000;
    const col: DateColumn = { kind: "date", name: f.id, values, hasTime: true, format: "YYYY-MM-DD HH:mm" };
    return col;
  }
  if (roles[0] === "boolean") {
    const values = new Int8Array(n);
    for (let i = 0; i < n; i++) values[i] = rng.chance(0.2) ? 1 : 0;
    const col: BooleanColumn = {
      kind: "boolean",
      name: f.id,
      values,
      trueLabel: "TRUE",
      falseLabel: "FALSE",
    };
    return col;
  }
  const classes = domain.valueClasses?.[f.id];
  if (classes && classes.length) {
    const pool = [...classes.map((c) => titleCase(c.keywords[0] as string)), "Other value"];
    return stringCol(
      f.id,
      Array.from({ length: n }, () => rng.pick(pool)),
    );
  }
  if (f.valueHints && f.valueHints.length) {
    return stringCol(
      f.id,
      Array.from({ length: n }, () => titleCase(rng.pick(f.valueHints as string[]))),
    );
  }
  const numeric =
    roles[0] === "measure" || roles[0] === "currency" || roles[0] === "rate" || roles[0] === "percentage";
  if (numeric) {
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const r = roles[0];
      values[i] =
        r === "percentage"
          ? Math.round(rng.float(0, 0.6) * 1000) / 1000
          : r === "rate"
            ? Math.round(rng.float(0.5, 5) * 100) / 100
            : r === "currency"
              ? Math.round(rng.float(10, 5000) * 100) / 100
              : rng.int(0, 20);
      if (rng.chance(0.02)) values[i] = NaN;
    }
    const col: NumberColumn = {
      kind: "number",
      name: f.id,
      values,
      format: { integer: roles[0] === "measure", decimals: 2 },
    };
    return col;
  }
  if (roles[0] === "identifier") {
    const card = Math.max(25, Math.floor(n / (2 + idIndex * 3)));
    const prefix = f.id.slice(0, 3).toUpperCase();
    return stringCol(
      f.id,
      Array.from({ length: n }, () => `${prefix}-${String(rng.int(1, card)).padStart(5, "0")}`),
    );
  }
  if (roles[0] === "geo")
    return stringCol(
      f.id,
      Array.from({ length: n }, () => rng.pick(STATES)),
    );
  return stringCol(
    f.id,
    Array.from({ length: n }, () => rng.pick(CATS)),
  );
}

export function syntheticDataset(domain: DomainDef, n = 2400, seed = 11): Dataset {
  const rng = new Rng(seed);
  const base = new Float64Array(n);
  const start = utc(2024, 1, 1);
  for (let i = 0; i < n; i++) base[i] = start + rng.int(0, 600) * DAY_MS;
  let idIndex = 0;
  const columns = domain.fields.map((f) => {
    const col = generateField(f, domain, n, rng, base, f.roles[0] === "identifier" ? idIndex++ : 0);
    return col;
  });
  return {
    id: `synthetic_${domain.id}`,
    name: `synthetic ${domain.id}`,
    rowCount: n,
    columns,
    source: { fileName: `${domain.id}.csv`, kind: "derived", sizeBytes: 0, isDemo: true },
  };
}

/** Every field mapped to its own column; value classes resolved from the generated values. */
export function identityMapping(domain: DomainDef, ds: Dataset): Mapping {
  const fields: Record<string, string> = {};
  const scores: Record<string, number> = {};
  for (const f of domain.fields) {
    fields[f.id] = f.id;
    scores[f.id] = 1;
  }
  const classes: Record<string, string[]> = {};
  for (const fieldId of Object.keys(domain.valueClasses ?? {})) {
    const col = ds.columns.find((c) => c.name === fieldId);
    const values = col && col.kind === "string" ? [...col.dict] : [];
    Object.assign(classes, resolveClassesForField(domain, fieldId, values));
  }
  return { fields, scores, classes };
}
