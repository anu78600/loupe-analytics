/**
 * Shareable dashboard config: everything needed to rebuild the same dashboard
 * from the same file (domain, mapping, overrides, layout, filters). Contains no
 * data values; a fingerprint guards against applying it to a different file.
 *
 * "No data values" means no rows and no computed results. The file does name
 * the columns, and filters and value-class overrides list the category
 * values they use, so it still describes the dataset's schema and vocabulary.
 * The fingerprint hashes column names and types only, not cell contents:
 * it catches a different schema, while a different row count is merely
 * reported. The JSON comes from outside, so its shape is validated with zod;
 * `customCharts` entries are the exception (z.unknown()).
 */
import { z } from "zod";
import type { Dataset } from "@/engine/core/types";
import { hashString } from "@/engine/core/stats";

// Mirrors SemanticRole in engine/profile/types; keep the two lists in sync.
const roleEnum = z.enum([
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
]);

/**
 * Mirrors the engine's Filter union (engine/query/filter), plus `sourceId` on
 * the click-to-filter (cross-filter) entry: the chart it came from, which
 * shows every category and highlights the chosen one instead of filtering
 * itself (the store's DashboardFilter).
 */
export const filterSchema = z.union([
  z.object({ kind: z.literal("dateRange"), column: z.string(), from: z.number(), to: z.number() }),
  z.object({
    kind: z.literal("in"),
    column: z.string(),
    values: z.array(z.string()),
    exclude: z.boolean().optional(),
    sourceId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("range"),
    column: z.string(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
]);

/** A dashboard widget: chart spec id, layout size and per-chart overrides (mirrors the store's Widget). */
export const widgetSchema = z.object({
  id: z.string(),
  kind: z.string().optional(),
  w: z.number(),
  h: z.number(),
  hidden: z.boolean().optional(),
  topN: z.number().optional(),
});

/**
 * Version 1 of the config file. Missing override maps default to empty, so a
 * hand-trimmed file still loads. `dashboard.filters` include the date range
 * and any cross-filter (tagged with `sourceId`), as returned by the store's
 * filters(). `settings.currency` is the effective currency when saved.
 */
export const configSchema = z.object({
  app: z.literal("loupe"),
  version: z.literal(1),
  createdAt: z.string(),
  fingerprint: z.object({
    fileName: z.string(),
    rowCount: z.number(),
    columns: z.array(z.object({ name: z.string(), type: z.string() })),
    hash: z.string(),
  }),
  domainId: z.string(),
  subDomainId: z.string().optional(),
  business: z
    .object({
      industry: z.string().optional(),
      model: z.string().optional(),
      goal: z.string().optional(),
      period: z.string().optional(),
      currency: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  mappingOverrides: z.record(z.string(), z.string().nullable()).default({}),
  classOverrides: z.record(z.string(), z.array(z.string())).default({}),
  /** Columns hidden in step 3 (kept in the file, never computed from); older configs have none. */
  hiddenColumns: z.array(z.string()).default([]),
  roleOverrides: z
    .record(
      z.string(),
      z.object({
        role: roleEnum,
        additivity: z.enum(["additive", "semi-additive", "non-additive"]).optional(),
      }),
    )
    .default({}),
  kpiRenames: z.record(z.string(), z.string()).default({}),
  kpiTargets: z.record(z.string(), z.number()).default({}),
  dashboard: z.object({
    mode: z.enum(["executive", "analyst", "compact"]),
    widgets: z.array(widgetSchema),
    customCharts: z.array(z.unknown()).default([]),
    datePreset: z.string(),
    filters: z.array(filterSchema),
  }),
  settings: z.object({ numberLocale: z.enum(["IN", "INTL"]), currency: z.string() }),
});

export type LoupeConfig = z.infer<typeof configSchema>;

/** Fingerprint from schema facts the UI already has (no dataset needed). The hash depends on column order. */
export function fingerprintOf(
  fileName: string,
  rowCount: number,
  columns: Array<{ name: string; type: string }>,
): LoupeConfig["fingerprint"] {
  return {
    fileName,
    rowCount,
    columns,
    hash: hashString(columns.map((c) => `${c.name}:${c.type}`).join("|")).toString(36),
  };
}

/** Fingerprint of a loaded dataset; the same facts as fingerprintOf(), so both sides of a comparison agree. */
export function datasetFingerprint(ds: Dataset): LoupeConfig["fingerprint"] {
  return fingerprintOf(
    ds.source.fileName,
    ds.rowCount,
    ds.columns.map((c) => ({ name: c.name, type: c.kind })),
  );
}

export interface FingerprintCheck {
  /** Every saved column exists with the same type (extra columns are fine). */
  ok: boolean;
  /** `ok`, plus the same row count and the same column hash (names, types and order). */
  exact: boolean;
  /** Human-readable reasons; a row-count difference is listed even when `ok`. */
  problems: string[];
}

/**
 * The one fingerprint check: same columns (names + types) are required; a
 * different row count is allowed with a warning. Takes fingerprints, so the
 * UI can use the schema facts it already holds (see checkFingerprint).
 */
export function compareFingerprints(
  saved: LoupeConfig["fingerprint"],
  current: LoupeConfig["fingerprint"],
): FingerprintCheck {
  const problems: string[] = [];
  const have = new Map(current.columns.map((c) => [c.name, c.type]));
  for (const c of saved.columns) {
    const t = have.get(c.name);
    if (!t) problems.push(`Column "${c.name}" is missing.`);
    else if (t !== c.type) problems.push(`Column "${c.name}" is ${t} here but was ${c.type}.`);
  }
  const ok = problems.length === 0;
  if (ok && current.rowCount !== saved.rowCount) {
    problems.push(
      `Row count differs (${current.rowCount.toLocaleString("en-US")} now vs ${saved.rowCount.toLocaleString("en-US")} when saved); the layout applies but numbers will differ.`,
    );
  }
  return { ok, exact: ok && current.rowCount === saved.rowCount && current.hash === saved.hash, problems };
}

/** compareFingerprints() against a loaded dataset. */
export function checkFingerprint(cfg: LoupeConfig, ds: Dataset): FingerprintCheck {
  return compareFingerprints(cfg.fingerprint, datasetFingerprint(ds));
}

/** Parses and validates a config file. Never throws: bad JSON or the first schema issue comes back as `error`. */
export function parseConfig(text: string): { config: LoupeConfig | null; error?: string } {
  try {
    const parsed = configSchema.safeParse(JSON.parse(text));
    if (!parsed.success)
      return {
        config: null,
        error: `Not a valid Loupe config: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
      };
    return { config: parsed.data };
  } catch {
    return { config: null, error: "The file isn't valid JSON." };
  }
}
