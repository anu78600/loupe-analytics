/**
 * Data dictionary (CSV and Markdown).
 *
 * One row per column with its export name, storage type, semantic role (after
 * the user's overrides), additivity, mapped domain field, completeness and a
 * few example values. Examples are real values from the file, so the CSV goes
 * through the injection-guarded tableToCsv and the Markdown escapes pipes and
 * newlines in free text.
 */
import { ROLE_LABEL } from "@/engine/profile/types";
import { tableToCsv } from "./csv";
import type { ExportContext } from "./context";

export interface DictionaryRow {
  column: string;
  exportName: string;
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
  return ctx.profile.columns.map((c) => {
    const mapped = fieldOf.get(c.name);
    const desc = [mapped ? `${mapped}.` : "", c.roleReason].filter(Boolean).join(" ");
    return {
      column: c.name,
      exportName: ctx.names.columns.get(c.name) ?? c.name,
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
      "Export name",
      "Storage type",
      "Semantic role",
      "Additivity",
      "Mapped to",
      "Blank %",
      "Distinct values",
      "Examples",
      "Description",
    ],
    rows.map((r) => [
      r.column,
      r.exportName,
      r.type,
      r.role,
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
    `${ctx.ds.rowCount.toLocaleString("en-US")} rows · ${ctx.profile.grain.description} · Domain: ${ctx.domain.name}`,
    "",
    "| Column | Export name | Type | Role | Additivity | Mapped to | Blank | Distinct | Examples |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${esc(r.column)} | \`${r.exportName}\` | ${r.type} | ${r.role} | ${r.additivity} | ${esc(r.mappedTo)} | ${r.nullPct} | ${r.distinct} | ${esc(r.examples)} |`,
    ),
    "",
  ].join("\n");
}
