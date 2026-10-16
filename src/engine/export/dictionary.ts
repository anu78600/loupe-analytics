/**
 * Data dictionary (CSV and Markdown).
 *
 * One row per column, with what an analyst's dictionary carries: the column
 * as written and its business name, the export name, storage type, semantic
 * role (after the user's overrides), unit, range (lowest to highest), whether
 * it is a key, the allowed values of a short list, additivity, the mapped
 * template field, completeness, a few example values and a description.
 * Values are real ones from the file, so the CSV goes through the
 * injection-guarded tableToCsv and the Markdown escapes pipes and newlines in
 * free text. A column the user hid is listed (it is still in the file) and
 * says so.
 */
import { ROLE_LABEL } from "@/engine/profile/types";
import { formatPlain } from "@/engine/core/format";
import { isoDate } from "@/engine/core/dates";
import { friendlyStart } from "@/engine/core/labels";
import { grainLabel } from "@/engine/profile/structure";
import { GENERIC_ID } from "@/engine/detect/generic";
import { tableToCsv } from "./csv";
import type { ExportContext } from "./context";

export interface DictionaryRow {
  column: string;
  /** The name a report would use: the template field it maps to, else the header read with spaces. */
  businessName: string;
  exportName: string;
  /** "INR", "%", "fraction (0–1)", "count", "days"… or blank. */
  unit: string;
  /** Lowest to highest, for numbers and dates. */
  range: string;
  /** "Yes" for a column that identifies a row on its own. */
  key: string;
  /** Every value, when there are 12 or fewer. */
  allowed: string;
  type: string;
  role: string;
  additivity: string;
  mappedTo: string;
  nullPct: string;
  distinct: number;
  examples: string;
  description: string;
}

/** Rows in dataset column order. The Markdown table leaves out `description`, which only the CSV carries. */
export function dictionaryRows(ctx: ExportContext): DictionaryRow[] {
  // Column → label of the domain field mapped to it.
  const fieldOf = new Map<string, string>();
  for (const [fieldId, column] of Object.entries(ctx.mapping.fields)) {
    const label = ctx.domain.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
    fieldOf.set(column, label);
  }
  const hidden = new Set(ctx.hiddenColumns ?? []);
  return ctx.profile.columns.map((c) => {
    const mapped = fieldOf.get(c.name);
    const desc = hidden.has(c.name)
      ? "Hidden in Loupe: kept as a reference; no KPI, chart or filter uses it."
      : [mapped ? `${mapped}.` : "", c.roleReason].filter(Boolean).join(" ");
    // Whole numbers print without decimals; others with two.
    const decimals = c.numeric && Number.isInteger(c.numeric.min) && Number.isInteger(c.numeric.max) ? 0 : 2;
    const range = c.numeric
      ? `${formatPlain(c.numeric.min, decimals, "INTL")} to ${formatPlain(c.numeric.max, decimals, "INTL")}`
      : c.temporal
        ? `${isoDate(c.temporal.min)} to ${isoDate(c.temporal.max)}`
        : "";
    const unit =
      c.role === "currency"
        ? (ctx.currency ?? "")
        : c.role === "percentage"
          ? c.percentScale === 1
            ? "fraction (0–1)"
            : "% (0–100)"
          : c.storage === "date"
            ? c.temporal?.hasTime
              ? "date and time"
              : "date"
            : "";
    const isKey =
      (ctx.profile.keys.primary?.length === 1 && ctx.profile.keys.primary[0] === c.name) || c.unique;
    // A short list of values (12 or fewer, all known) is the column's allowed values.
    const top = c.categorical?.top ?? [];
    const allowed =
      (c.storage === "string" || c.storage === "boolean") &&
      c.distinct > 0 &&
      c.distinct <= 12 &&
      top.length >= c.distinct
        ? top.map((v) => v.value).join("; ")
        : "";
    return {
      column: hidden.has(c.name) ? `${c.name} (hidden)` : c.name,
      businessName: mapped ?? friendlyStart(c.name),
      exportName: ctx.names.columns.get(c.name) ?? c.name,
      unit,
      range,
      key: isKey ? "Yes" : "",
      allowed,
      type: c.storage,
      role: ROLE_LABEL[c.role],
      additivity: c.additivity ?? "",
      mappedTo: mapped ?? "",
      nullPct: `${(c.nullPct * 100).toFixed(1)}%`,
      distinct: c.distinct,
      examples: c.examples.slice(0, 3).join("; "),
      description: desc,
    };
  });
}

export function dictionaryCsv(ctx: ExportContext): string {
  const rows = dictionaryRows(ctx);
  return tableToCsv(
    [
      "Column",
      "Business name",
      "Export name",
      "Storage type",
      "Semantic role",
      "Unit",
      "Range",
      "Key",
      "Allowed values",
      "Additivity",
      "Mapped to",
      "Blank %",
      "Distinct values",
      "Examples",
      "Description",
    ],
    rows.map((r) => [
      r.column,
      r.businessName,
      r.exportName,
      r.type,
      r.role,
      r.unit,
      r.range,
      r.key,
      r.allowed,
      r.additivity,
      r.mappedTo,
      r.nullPct,
      r.distinct,
      r.examples,
      r.description,
    ]),
  );
}

export function dictionaryMarkdown(ctx: ExportContext): string {
  const rows = dictionaryRows(ctx);
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `# Data dictionary · ${ctx.ds.source.fileName}`,
    "",
    `${ctx.ds.rowCount.toLocaleString("en-US")} rows · ${grainLabel(ctx.profile.grain, ctx.domain.id !== GENERIC_ID ? ctx.subDomain?.grain : undefined)} · Industry: ${ctx.domain.name}`,
    "",
    "| Column | Business name | Export name | Type | Role | Unit | Range | Key | Blank | Distinct | Allowed values or examples |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${esc(r.column)} | ${esc(r.businessName)} | \`${r.exportName}\` | ${r.type} | ${r.role} | ${esc(r.unit)} | ${esc(r.range)} | ${r.key} | ${r.nullPct} | ${r.distinct} | ${esc(r.allowed || r.examples)} |`,
    ),
    "",
    // What each column means, under the table: too long for a cell, too useful to leave out.
    "## What each column means",
    "",
    ...rows.map(
      (r) =>
        `- **${esc(r.column)}**${r.mappedTo ? ` (${esc(r.mappedTo)})` : ""}: ${esc(r.description || "No notes.")}`,
    ),
    "",
  ].join("\n");
}
