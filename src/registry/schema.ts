/**
 * Zod schema for the domain registry. Domain knowledge (fields, synonyms,
 * value classes, KPIs, charts, pitfalls) lives in JSON files validated here,
 * never hard-coded in components.
 *
 * Authoring notes for a new domain file:
 *  - Every object is strict, so a misspelt key fails validation instead of
 *    being ignored; index.ts then skips the whole domain (logged).
 *  - Field ids are the vocabulary of everything else (KPI expressions, value
 *    classes, sub-domain signals, chart axes); validate.ts checks those
 *    references and KPI ref cycles at load time.
 *  - Order is meaningful in four places: KPI variants (first available wins),
 *    value classes of a field (a value joins the first matching class),
 *    sub-domains (the first is the primary one) and sub-domain signals (the
 *    first mapped date signal becomes the dashboard's date axis).
 *  - The expression schemas mirror query/expr.ts, where their semantics are
 *    documented; change both together.
 */
import { z } from "zod";
import type { Expr, Predicate, RowExpr } from "@/engine/query/expr";

const cmp = z.enum(["gt", "gte", "lt", "lte", "eq", "neq"]);

// The z.ZodType<…> annotations are required by the recursive z.lazy schemas
// and make TypeScript reject a shape the expression types don't allow. A
// variant missing from a schema is not caught, so keep the two in step.

/** Row expression (RowExpr in query/expr.ts): used in aggregates' `of` and in bin axes. */
export const rowExprSchema: z.ZodType<RowExpr> = z.lazy(() =>
  z.union([
    z.object({ field: z.string() }).strict(),
    z.object({ num: z.number() }).strict(),
    z
      .object({ op: z.enum(["add", "sub", "mul", "div"]), args: z.tuple([rowExprSchema, rowExprSchema]) })
      .strict(),
    z.object({ daysBetween: z.tuple([z.string(), z.string()]) }).strict(),
  ]),
);

/** Row filter (Predicate in query/expr.ts). Prefer notClass over `not` + class when the field can be blank. */
export const predicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.object({ field: z.string(), in: z.array(z.string()) }).strict(),
    z.object({ field: z.string(), class: z.string() }).strict(),
    z.object({ field: z.string(), notClass: z.string() }).strict(),
    z.object({ field: z.string(), isTrue: z.literal(true) }).strict(),
    z.object({ field: z.string(), isFalse: z.literal(true) }).strict(),
    z.object({ field: z.string(), cmp, value: z.number() }).strict(),
    z.object({ field: z.string(), cmpField: cmp, other: z.string() }).strict(),
    z.object({ field: z.string(), notNull: z.literal(true) }).strict(),
    z.object({ field: z.string(), isNull: z.literal(true) }).strict(),
    z.object({ and: z.array(predicateSchema).min(1) }).strict(),
    z.object({ or: z.array(predicateSchema).min(1) }).strict(),
    z.object({ not: predicateSchema }).strict(),
  ]),
);

/** Measure expression (Expr in query/expr.ts). Field names inside are field ids of the same domain. */
export const exprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    z
      .object({
        agg: z.enum(["sum", "avg", "min", "max", "median"]),
        of: rowExprSchema,
        where: predicateSchema.optional(),
      })
      .strict(),
    z.object({ agg: z.literal("count"), where: predicateSchema.optional() }).strict(),
    z.object({ agg: z.literal("countDistinct"), of: z.string(), where: predicateSchema.optional() }).strict(),
    z.object({ agg: z.literal("spanDays"), of: z.string(), where: predicateSchema.optional() }).strict(),
    z.object({ op: z.enum(["add", "sub", "mul", "div"]), args: z.tuple([exprSchema, exprSchema]) }).strict(),
    z.object({ num: z.number() }).strict(),
    z.object({ ref: z.string() }).strict(),
    z.object({ calc: exprSchema, where: predicateSchema }).strict(),
    z
      .object({
        per: z.string(),
        inner: exprSchema,
        reduce: z.enum(["avg", "sum", "count", "median", "min", "max"]),
        having: z.object({ expr: exprSchema, cmp, value: z.number() }).strict().optional(),
      })
      .strict(),
    z.object({ newEntities: z.string(), date: z.string() }).strict(),
    z.object({ atLatest: z.string(), expr: exprSchema }).strict(),
  ]),
);

/** Semantic roles: inferred for each column by profiling, accepted by each field. */
export const ROLE_VALUES = [
  "identifier",
  "datetime",
  "time",
  "dimension",
  "measure",
  "rate",
  "currency",
  "percentage",
  "geo",
  "text",
  "boolean",
] as const;

/** Chart kinds a template may name; isKindCompatible in charts/recommend.ts decides which can render a given spec. */
export const CHART_KINDS = [
  "line",
  "area",
  "bar",
  "hbar",
  "stackedBar",
  "donut",
  "treemap",
  "scatter",
  "histogram",
  "box",
  "heatmap",
  "funnel",
  "waterfall",
  "bullet",
  "cohort",
  "bump",
  "pareto",
  "geoTile",
  "table",
  // Added for the chart builder (engine/charts/catalogue.ts describes each).
  "pie",
  "groupedBar",
  "stackedBar100",
  "stackedArea",
  "step",
  "lollipop",
  "dumbbell",
  "bubble",
  "radar",
  "gauge",
  "sunburst",
  "sankey",
  "calendar",
  "bigNumber",
] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

/**
 * A business field the domain understands (e.g. order_date), matched to at
 * most one column of the uploaded table by detect/match.ts.
 */
export const fieldSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    /** Display name; also matched against column names, like a synonym. */
    label: z.string(),
    description: z.string().optional(),
    /**
     * Roles a matching column may have; a column whose inferred role is listed
     * gets full compatibility. The first role is the primary one: a field whose
     * first role is "datetime" can become the dashboard's date axis.
     */
    roles: z.array(z.enum(ROLE_VALUES)).min(1),
    /** Alternative column names, compared after tokenising (case, separators, abbreviations and plurals normalised). */
    synonyms: z.array(z.string()).min(1),
    /**
     * Name tokens that disqualify a column (e.g. "ship" for an order date).
     * Applied per synonym: a synonym's similarity is multiplied by 0.3 when
     * the column contains an excluded token that this synonym doesn't name
     * itself (so "ship date" can still match a ship-date field's own synonym).
     */
    exclude: z.array(z.string()).optional(),
    /**
     * Typical values that strengthen a match (lower-case).
     * A value equal to or containing a hint counts; hints shorter than five
     * characters (cod, upi, 4g) must appear as a whole word. It takes two
     * different recognised values, or one covering 90% of rows.
     */
    valueHints: z.array(z.string()).optional(),
    /** Importance 0–5: weights sub-domain coverage and detection breadth, and wins close assignment contests. */
    weight: z.number().min(0).max(5),
    /** Listed first and badged "core" on the mapping screen. */
    core: z.boolean().optional(),
  })
  .strict();

/**
 * A meaning for some of a field's values, e.g. order_status → rto. Keywords
 * match the mapped column's distinct values: keywords under five characters
 * as whole words, longer ones also as word prefixes ("cancel" → "cancelled"),
 * multi-word keywords as phrases. Listed in priority order per field.
 */
export const valueClassSchema = z
  .object({ id: z.string(), label: z.string(), keywords: z.array(z.string()).min(1) })
  .strict();

/**
 * One way to compute a KPI. `label` names the formula in the UI; `caveat` is
 * shown with values computed by this variant.
 */
export const kpiVariantSchema = z
  .object({ id: z.string(), label: z.string(), expr: exprSchema, caveat: z.string().optional() })
  .strict();

/** Display formats; "percent" values are fractions (0.25 shows as 25%). */
export const KPI_FORMATS = ["currency", "number", "integer", "percent", "ratio", "days", "decimal"] as const;

/** A KPI: its meaning, display and one or more formula variants. */
export const kpiSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    name: z.string(),
    /** Short label for charts and tight spaces. */
    short: z.string().optional(),
    definition: z.string(),
    /** Human-readable formula, shown next to the definition. */
    formula: z.string(),
    format: z.enum(KPI_FORMATS),
    /** Whether an increase is good news; sets the tone of deltas and insights. */
    direction: z.enum(["higher", "lower", "neutral"]),
    /** Card slot: 4–6 heroes and up to 12 supporting KPIs are shown (see selectKpis in kpi/resolve.ts). */
    tier: z.enum(["hero", "supporting", "detail"]),
    /** Lower = more important; orders KPIs within their tier. */
    priority: z.number(),
    /** Grouping label for KPIs in the UI; also the Power BI display folder. */
    group: z.string(),
    /**
     * Restricts the KPI to these sub-domains (omitted = all). Never ref a KPI
     * that is excluded from a sub-domain this one appears in: resolveKpis
     * drops the excluded KPI there, and evaluating the ref then fails.
     */
    subDomains: z.array(z.string()).optional(),
    /** Helper measure: never shown as a card but can be referenced; exported as hidden. */
    hidden: z.boolean().optional(),
    /** Formula variants in preference order: the first whose fields, positive classes and refs are all available is used. */
    variants: z.array(kpiVariantSchema).min(1),
    /** Typical range for context, in the KPI's own units; shown as a reference, never computed from the data. */
    benchmark: z
      .object({ low: z.number().optional(), high: z.number().optional(), note: z.string() })
      .strict()
      .optional(),
    /** Interpretation warnings for this KPI. */
    pitfalls: z.array(z.string()).optional(),
  })
  .strict();

/**
 * A chart axis in field ids. `time`: a date field, grain chosen from the span
 * when omitted. `field`: a category field. `part`: weekday, hour or month of
 * a date field (hour falls back to month when the dates have no time).
 * `bins`: histogram bands of a row expression, `count` target bins (default
 * 10). `none`: no axis, as used by funnel and analysis charts.
 */
export const axisSchema = z.union([
  z
    .object({ time: z.string(), grain: z.enum(["day", "week", "month", "quarter", "year"]).optional() })
    .strict(),
  z.object({ field: z.string() }).strict(),
  z.object({ part: z.enum(["dow", "hour", "month"]), of: z.string() }).strict(),
  z
    .object({
      bins: rowExprSchema,
      count: z.number().optional(),
      format: z.enum(["number", "currency", "percent"]).optional(),
      label: z.string(),
    })
    .strict(),
  z.object({ none: z.literal(true) }).strict(),
]);

/** A chart the domain recommends; recommendCharts adapts or skips it to fit the mapped data. */
export const chartTemplateSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    /** Preferred kind; may be swapped (tile map without state geography, donut with too many categories). */
    kind: z.enum(CHART_KINDS),
    /** "columns" is reserved for charts built from columns the template doesn't use (kpi/columnKpis). */
    section: z.enum(["trend", "breakdown", "drivers", "detail", "columns"]),
    x: axisSchema,
    /** Second key, used by heatmaps, stacked bars and treemaps. */
    series: axisSchema.optional(),
    /** KPI ids; the chart is skipped unless every one is available. */
    measures: z.array(z.string()).min(1),
    /** rfm/cohort/basket read fixed field ids (see charts/recommend.ts); pareto and funnel post-process the measures. */
    analysis: z.enum(["rfm", "cohort", "basket", "pareto", "funnel"]).optional(),
    topN: z.number().optional(),
    /** Fold the groups beyond topN into a recomputed "Others". */
    others: z.boolean().optional(),
    /** Field ids from the x field downwards, for drill-down (needs two mapped levels). */
    drill: z.array(z.string()).optional(),
    /** Groups with fewer rows are set aside as too small to compare. */
    minGroupRows: z.number().optional(),
    /** Extra field ids the chart relies on; only checked to exist by validate.ts, not consulted when recommending. */
    requires: z.array(z.string()).optional(),
    /** "Why this chart" text shown to the user. */
    reason: z.string(),
    /** Kinds offered in the switcher; the first non-geoTile one replaces a tile map that can't be drawn. */
    alternatives: z.array(z.enum(CHART_KINDS)),
    /** Grid units: width out of 12 columns, height in rows. */
    size: z.object({ w: z.number().min(3).max(12), h: z.number().min(2).max(8) }).strict(),
    /** Order within the section (lower first); without `modes` it also decides executive-mode inclusion. */
    priority: z.number(),
    /** Restricts the chart to these sub-domains; untagged charts belong to the first sub-domain. */
    subDomains: z.array(z.string()).optional(),
    /** Layout modes that show the chart; derived from section and priority when omitted. */
    modes: z.array(z.enum(["executive", "analyst", "compact"])).optional(),
  })
  .strict();

/** A kind of table within the domain (e.g. orders, returns, customer master), detected from which signal fields match. */
export const subDomainSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    /** Field ids whose (weighted) matches make up this sub-domain's coverage score. */
    signals: z.array(z.string()).min(1),
    /** What one row represents, as a short noun (e.g. "order line"). */
    grain: z.string(),
    /**
     * How rows relate to time. "events" (the default): each row happened on
     * its date (orders, tickets, visits), so a date range selects activity in
     * a period. "roster": each row is a standing entity (an employee, a
     * customer, a product, a policy) and its date says when it started, so a
     * date range selects a cohort. Loupe then defaults to the whole file and
     * shows no period-over-period deltas unless the user picks a range.
     */
    timeModel: z.enum(["events", "roster"]).optional(),
  })
  .strict();

/** One industry: its fields, value meanings, sub-domains, KPIs and chart templates. */
export const domainSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    name: z.string(),
    tagline: z.string(),
    description: z.string(),
    icon: z.string(),
    /** Marks the featured domain in the UI. */
    flagship: z.boolean().optional(),
    /** Singular noun for one row (e.g. "order"); exports pluralise it for the table name, "row" gives "Data". */
    entity: z.string(),
    /** Business goals the domain serves (descriptive; not read by the engine). */
    goals: z.array(z.string()).optional(),
    fields: z.array(fieldSchema).min(3),
    /** Field id → its value classes, in priority order. */
    valueClasses: z.record(z.string(), z.array(valueClassSchema)).optional(),
    /** The first sub-domain is the primary one. */
    subDomains: z.array(subDomainSchema).min(1),
    kpis: z.array(kpiSchema).min(1),
    charts: z.array(chartTemplateSchema),
    /** Domain-level interpretation warnings (the first four go into the export README). */
    pitfalls: z.array(z.string()).min(1),
  })
  .strict();

export type FieldDef = z.infer<typeof fieldSchema>;
export type ValueClassDef = z.infer<typeof valueClassSchema>;
export type KpiVariant = z.infer<typeof kpiVariantSchema>;
export type KpiDef = z.infer<typeof kpiSchema>;
export type KpiFormat = (typeof KPI_FORMATS)[number];
export type AxisDef = z.infer<typeof axisSchema>;
export type ChartTemplate = z.infer<typeof chartTemplateSchema>;
export type SubDomainDef = z.infer<typeof subDomainSchema>;
export type DomainDef = z.infer<typeof domainSchema>;
