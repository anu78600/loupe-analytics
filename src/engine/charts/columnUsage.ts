/**
 * Which of the file's columns the dashboard is built from, and what each
 * one feeds: KPIs (through the field mapping, refs included), charts (axes,
 * series, drill paths, histogram bins, ad-hoc "agg:" measures, the inputs of
 * RFM/cohort/basket analyses) and the filters (primary date, filter rail).
 *
 * The dashboard never invents a column: everything here resolves to a name
 * in the file. The mapping step shows it per column ("Used by") and the
 * dashboard header summarises it ("Built from N of your M columns"), so the
 * user can see that nothing was added.
 */
import { fieldsOf } from "@/engine/query/expr";
import type { Mapping } from "@/engine/detect/mapping";
import type { ChartSpec, ResolvedAxis } from "./types";

/** What one column feeds. Names are display names (KPI names, chart titles). */
export interface ColumnUse {
  kpis: string[];
  charts: string[];
  /** "Date filter" for the primary date, "Filter" for a filter-rail column. */
  filters: string[];
}

/** The slice of the analysis context this needs (ContextResult satisfies it). */
export interface UsageInput {
  mapping: Mapping;
  kpis: Array<{
    id: string;
    name: string;
    available: boolean;
    hidden: boolean;
    fieldsUsed: Array<{ column: string }>;
  }>;
  dateColumn: string | null;
  dimensions: Array<{ column: string }>;
  profile: { columns: Array<{ name: string }> };
}

/**
 * Column name → its uses, for every column of the file (unused columns get
 * empty lists). `specs` are the charts to account for: the recommended ones
 * plus any the user built.
 */
export function columnUsage(input: UsageInput, specs: ChartSpec[]): Map<string, ColumnUse> {
  const out = new Map<string, ColumnUse>(
    input.profile.columns.map((c) => [c.name, { kpis: [], charts: [], filters: [] }]),
  );
  const add = (column: string | undefined, key: keyof ColumnUse, label: string) => {
    const u = column ? out.get(column) : undefined;
    if (u && !u[key].includes(label)) u[key].push(label);
  };
  // A FieldRef is a domain field id (mapped to a column) or "col:<name>".
  const columnOfRef = (ref: string) => (ref.startsWith("col:") ? ref.slice(4) : input.mapping.fields[ref]);
  const kpiColumns = new Map(input.kpis.map((k) => [k.id, k.fieldsUsed.map((f) => f.column)]));

  for (const k of input.kpis) {
    // Hidden helpers are counted through the KPIs that use them (their fields are merged in).
    if (!k.available || k.hidden) continue;
    for (const f of k.fieldsUsed) add(f.column, "kpis", k.name);
  }

  for (const spec of specs) {
    const cols = specColumns(spec, columnOfRef);
    // KPI measures read their columns through the mapping (refs included).
    for (const m of spec.measures)
      if (!m.id.startsWith("agg:")) for (const c of kpiColumns.get(m.id) ?? []) cols.add(c);
    const monetary = spec.analysisParams?.monetary;
    if (monetary) for (const c of kpiColumns.get(monetary) ?? []) cols.add(c);
    for (const c of cols) add(c, "charts", spec.title);
  }

  if (input.dateColumn) add(input.dateColumn, "filters", "Date filter");
  for (const d of input.dimensions) add(d.column, "filters", "Filter");
  return out;
}

/** True when a column feeds anything at all. */
export function isUsed(u: ColumnUse | undefined): boolean {
  return Boolean(u && (u.kpis.length || u.charts.length || u.filters.length));
}

/**
 * Columns a chart reads directly: its axes (a histogram's binned expression
 * included), series and drill path, its ad-hoc "agg:" measures and the raw
 * inputs of an RFM, cohort or basket analysis. KPI measures (and an
 * analysis's monetary KPI) are not included: they read their columns through
 * the field mapping. `columnOfRef` turns a field reference (a domain field id
 * or "col:<name>") into a column name.
 */
export function specColumns(spec: ChartSpec, columnOfRef: (ref: string) => string | undefined): Set<string> {
  const axisColumns = (a: ResolvedAxis | undefined): string[] => {
    if (!a || a.kind === "none") return [];
    if (a.kind === "bins") return [...fieldsOf(a.expr)].map(columnOfRef).filter((c): c is string => !!c);
    return [a.column];
  };
  const cols = new Set<string>([...axisColumns(spec.x), ...axisColumns(spec.series), ...(spec.drill ?? [])]);
  for (const m of spec.measures) {
    // "agg:<fn>:<column>" names its column; "agg:count:" (row count) has none.
    if (!m.id.startsWith("agg:")) continue;
    const col = m.id.split(":").slice(2).join(":");
    if (col) cols.add(col);
  }
  const p = spec.analysisParams;
  if (p) for (const c of [p.customer, p.date, p.order, p.item]) if (c) cols.add(c);
  return cols;
}
