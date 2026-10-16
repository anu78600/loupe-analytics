/**
 * Wires a dataset + mapping + KPI resolution into evaluator, SQL and DAX contexts.
 *
 * All three resolve FieldRefs through columnForRef, so the on-screen number
 * and the exported formula always read the same column. The SQL and DAX
 * contexts emit the export-safe names from CompileNames, not raw headers.
 */
import { wordLabels } from "@/engine/core/booleans";
import type { Column, Dataset, StorageType } from "@/engine/core/types";
import type { Mapping } from "@/engine/detect/mapping";
import { MissingFieldError, UnavailableKpiError, type Resolver } from "@/engine/query/evaluate";
import type { Expr } from "@/engine/query/expr";
import { quoteIdent, type SqlContext } from "@/engine/compile/sql";
import { daxColumn, daxMeasureName, daxTableName, type DaxContext } from "@/engine/compile/dax";
import type { KpiResolutionMap } from "./resolve";

/** Extra ad-hoc measures (generic dashboards, custom charts) resolvable by id. */
export type ExtraMeasures = ReadonlyMap<string, Expr>;

/** Column behind a FieldRef: "col:<name>" bypasses the mapping. Throws MissingFieldError when unmapped or absent. */
export function columnForRef(ds: Dataset, mapping: Mapping, ref: string): Column {
  const name = ref.startsWith("col:") ? ref.slice(4) : mapping.fields[ref];
  if (!name) throw new MissingFieldError(ref);
  const col = ds.columns.find((c) => c.name === name);
  if (!col) throw new MissingFieldError(ref);
  return col;
}

const AGG_ID = /^agg:(sum|avg|min|max|median|count|countDistinct):(.*)$/;

/**
 * Ad-hoc measures from the chart builder: "agg:sum:Revenue", "agg:countDistinct:Customer", "agg:count:".
 * Everything after the second colon is the raw column name (it may contain
 * colons); "count" ignores it and counts rows. Returns null for other ids.
 */
export function aggIdToExpr(id: string): Expr | null {
  const m = AGG_ID.exec(id);
  if (!m) return null;
  const agg = m[1] as "sum" | "avg" | "min" | "max" | "median" | "count" | "countDistinct";
  const ref = `col:${m[2]}`;
  if (agg === "count") return { agg: "count" };
  if (agg === "countDistinct") return { agg: "countDistinct", of: ref };
  return { agg, of: { field: ref } };
}

/**
 * Evaluator resolver. A KPI id resolves, in order, as an ad-hoc "agg:" id, an
 * `extra` measure, then the chosen registry variant; anything else throws
 * UnavailableKpiError.
 */
export function makeResolver(
  ds: Dataset,
  mapping: Mapping,
  res: KpiResolutionMap,
  extra?: ExtraMeasures,
): Resolver {
  return {
    column: (ref) => columnForRef(ds, mapping, ref),
    classValues: (ref, cls) => mapping.classes[`${ref}.${cls}`] ?? [],
    kpi: (id) => {
      const adHoc = aggIdToExpr(id);
      if (adHoc) return adHoc;
      const x = extra?.get(id);
      if (x) return x;
      const r = res.get(id);
      if (!r || !r.available || !r.variant) throw new UnavailableKpiError(id);
      return r.variant.expr;
    },
  };
}

/**
 * snake_case ASCII names that are safe in SQL, DAX and Power Query.
 * Accents are stripped, "%" becomes "pct", "#" becomes "no" and camelCase is
 * split; a leading digit gets a "c_" prefix and repeats get _2, _3, ...
 * Returns original name → clean name.
 */
export function cleanColumnNames(names: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const n of names) {
    // NFKD splits accented letters; the character class below is the combining
    // marks block (U+0300–U+036F), which removes the accents.
    let base =
      n
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/%/g, " pct ")
        // "Order #" → order_num: "no" would read as a yes/no flag.
        .replace(/#/g, " num ")
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "column";
    if (/^\d/.test(base)) base = `c_${base}`;
    let name = base;
    let i = 2;
    while (used.has(name)) name = `${base}_${i++}`;
    used.add(name);
    out.set(n, name);
  }
  return out;
}

/** Storage kind behind a FieldRef; the compilers use it to spell isTrue/isFalse tests. */
export function storageOf(ds: Dataset, mapping: Mapping, ref: string): StorageType {
  return columnForRef(ds, mapping, ref).kind;
}

/** A yes/no field's own spellings when the file used words, so SQL and DAX compare with them (core/booleans.ts). */
export function boolLabelsOf(
  ds: Dataset,
  mapping: Mapping,
  ref: string,
): { true: string; false: string } | null {
  const col = columnForRef(ds, mapping, ref);
  return col.kind === "boolean" ? wordLabels(col) : null;
}

/** Export names shared by the SQL, DAX and Power BI outputs (built by export/names.ts). */
export interface CompileNames {
  /** Unquoted table name, e.g. "Orders". */
  table: string;
  /** Original column name → export-safe name. */
  columns: Map<string, string>;
  /** KPI id → measure display name. */
  measures: Map<string, string>;
}

/** SQL compiler context; refs (including `extra` and ad-hoc measures) are inlined, since SQL has no measures. */
export function makeSqlContext(
  ds: Dataset,
  mapping: Mapping,
  res: KpiResolutionMap,
  names: CompileNames,
  extra?: ExtraMeasures,
): SqlContext {
  const resolver = makeResolver(ds, mapping, res, extra);
  return {
    table: quoteIdent(names.table),
    col: (ref) => {
      const col = columnForRef(ds, mapping, ref);
      return quoteIdent(names.columns.get(col.name) ?? col.name);
    },
    colType: (ref) => storageOf(ds, mapping, ref),
    boolLabels: (ref) => boolLabelsOf(ds, mapping, ref),
    classValues: resolver.classValues,
    kpiExpr: resolver.kpi,
  };
}

/**
 * DAX compiler context. Refs compile to measure references by display name
 * (names.measures), so they must be KPIs exported in the same model.
 * `opts.dateTable` names the exported calendar table (column [Date]); null when there is none.
 */
export function makeDaxContext(
  ds: Dataset,
  mapping: Mapping,
  res: KpiResolutionMap,
  names: CompileNames,
  opts: { dateTable: string | null },
): DaxContext {
  const resolver = makeResolver(ds, mapping, res);
  return {
    table: daxTableName(names.table),
    col: (ref) => {
      const col = columnForRef(ds, mapping, ref);
      return daxColumn(names.table, names.columns.get(col.name) ?? col.name);
    },
    colType: (ref) => storageOf(ds, mapping, ref),
    boolLabels: (ref) => boolLabelsOf(ds, mapping, ref),
    classValues: resolver.classValues,
    measure: (id) => daxMeasureName(names.measures.get(id) ?? id),
    dateTable: opts.dateTable ? daxTableName(opts.dateTable) : null,
    dateTableColumn: opts.dateTable ? daxColumn(opts.dateTable, "Date") : null,
  };
}
