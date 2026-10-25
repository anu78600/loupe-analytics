/**
 * The dashboard as an Excel workbook (version 56.0), for people who carry on
 * in Excel or Google Sheets:
 *
 * - Summary: the dashboard's title, period, comparison and filters, then its
 *   KPIs with value, change, the two figures the change runs from and to,
 *   what it compares and the definition, each in its native format
 *   (currency, %, days…). "To" is the value itself unless the change covers
 *   a shorter window (the same months as the comparison), as on the cards.
 * - One sheet per chart on the dashboard, with the values it draws
 *   (chartTable.ts, as its CSV): periods as real dates, figures as numbers.
 * - Data: the rows behind the dashboard (its period and filters), with the
 *   file's own headers, numbers as numbers, dates as dates, and yes/no
 *   columns as written (core/booleans.ts: words stay words, TRUE/FALSE stay
 *   true/false). A column hidden in Loupe is still there, as in every export.
 * - Dictionary: what each column is (dictionary.ts).
 *
 * Every figure is the dashboard's own (the same KPI values and chart data),
 * so a SUM over Data equals the dashboard's total for a summed KPI. Nothing
 * is estimated: a KPI without a value is left blank with its reason.
 */
import type { Dataset } from "@/engine/core/types";
import type { ValueFormat } from "@/engine/core/format";
import { currencySymbol } from "@/engine/core/format";
import type { ChartData } from "@/engine/charts/types";
import type { KpiValue } from "@/engine/kpi/compute";
import { wordLabels } from "@/engine/core/booleans";
import type { ColumnProfile } from "@/engine/profile/types";
import { chartTable } from "./chartTable";
import type { DictionaryRow } from "./dictionary";
import {
  excelDate,
  excelTime,
  XLSX_MAX_ROWS,
  xlsxWorkbook,
  type XlsxCell,
  type XlsxSheet,
  type XlsxStyle,
} from "./xlsx";

/** The parts of a KPI the workbook prints (KpiMeta in session.ts). */
export interface WorkbookKpi {
  name: string;
  format: ValueFormat;
  definition: string;
  unavailableReason?: string;
}

export interface WorkbookInput {
  title: string;
  subtitle: string;
  /** What the figures cover, as the dashboard says it: Period, Compared with, Filters, Data to… */
  facts: Array<{ label: string; value: string }>;
  kpis: Array<{ meta: WorkbookKpi; value: KpiValue | undefined }>;
  charts: Array<{ title: string; headline?: string; data: ChartData }>;
  ds: Dataset;
  /** The column profiles, for each column's role (a currency column gets two decimals). */
  columns: readonly ColumnProfile[];
  /** The rows behind the dashboard, in file order. */
  rows: Int32Array;
  dictionary: DictionaryRow[];
  /** ISO 4217 code of the dashboard's currency ("" for none). */
  currency: string;
}

/** The style of a figure in a value format; a plain "number" is whole or has two decimals. */
function styleOf(format: ValueFormat | "text", values: ReadonlyArray<unknown> = []): XlsxStyle {
  switch (format) {
    case "currency":
      return "currency";
    case "integer":
      return "integer";
    case "percent":
      return "percent";
    case "ratio":
      return "ratio";
    case "days":
      return "days";
    case "decimal":
      return "decimal";
    case "number":
      return values.every((v) => typeof v !== "number" || Number.isInteger(v)) ? "integer" : "decimal";
    default:
      return "text";
  }
}

const width = (texts: Iterable<string>, min = 8, max = 50) => {
  let w = min;
  for (const t of texts) w = Math.max(w, t.length + 2);
  return Math.min(max, w);
};

/**
 * Characters a column of figures needs in its format, so Excel never shows "####": the digits of
 * the largest with grouping (Indian, the widest), its sign, decimals, suffix and currency symbol.
 */
function figureWidth(values: Iterable<unknown>, style: XlsxStyle, symbol: string): number {
  let max = 0;
  for (const v of values) if (typeof v === "number" && Number.isFinite(v)) max = Math.max(max, Math.abs(v));
  if (style === "percent" || style === "change") max *= 100;
  const digits = Math.max(1, Math.floor(Math.log10(Math.max(1, max))) + 1);
  const decimals =
    style === "currency" || style === "decimal" || style === "ratio"
      ? 3
      : style === "integer" || style === "text"
        ? max % 1
          ? 6
          : 0
        : 2;
  const suffix =
    style === "days" ? 5 : style === "points" ? 3 : style === "percent" || style === "change" ? 1 : 0;
  const sym = style === "currency" ? symbol.length : 0;
  return digits + Math.ceil(digits / 2) + decimals + suffix + sym + 3;
}

function summarySheet(input: WorkbookInput, shownRows: number, symbol: string): XlsxSheet {
  const rows: XlsxCell[][] = [
    [{ v: input.title, s: "title" }],
    [{ v: input.subtitle, s: "subtitle" }],
    [],
    ...input.facts.map((f): XlsxCell[] => [{ v: f.label, s: "label" }, f.value]),
    [
      { v: "Rows in this selection", s: "label" },
      { v: input.rows.length, s: "integer" },
    ],
    [],
    ["KPI", "Value", "Change", "From", "To", "Change compares", "Definition"].map((h) => ({
      v: h,
      s: "header" as const,
    })),
  ];
  const figures: unknown[] = [];
  for (const { meta, value } of input.kpis) {
    const style = styleOf(meta.format, [value?.value, value?.previous, value?.current]);
    figures.push(value?.value, value?.previous, value?.current);
    // A rate changes by points, anything else by a share of where it was (as on the cards).
    const change =
      meta.format === "percent"
        ? value?.deltaAbs !== null && value?.deltaAbs !== undefined
          ? { v: value.deltaAbs * 100, s: "points" as const }
          : null
        : value?.delta !== null && value?.delta !== undefined
          ? { v: value.delta, s: "change" as const }
          : null;
    const compares = value?.comparisonLabel
      ? `${value.currentLabel ? `${value.currentLabel} ` : ""}${value.comparisonLabel}`
      : "";
    const blank = value?.value === null || value?.value === undefined;
    const hasChange = value?.previous !== null && value?.previous !== undefined;
    rows.push([
      meta.name,
      { v: value?.value ?? null, s: style },
      change,
      { v: hasChange ? value.previous : null, s: style },
      { v: hasChange ? value.current : null, s: style },
      compares,
      blank && meta.unavailableReason ? `No value: ${meta.unavailableReason}` : meta.definition,
    ]);
  }
  rows.push([]);
  rows.push([
    {
      v: "Every figure is computed by Loupe from your file, with the dashboard's period and filters. Each chart has a sheet with its values; Data holds the rows behind them.",
      s: "note",
    },
  ]);
  if (shownRows < input.rows.length)
    rows.push([
      {
        v: `Data holds the first ${shownRows.toLocaleString("en-US")} of these rows, the most a sheet can hold; the CSV export has them all.`,
        s: "note",
      },
    ]);
  return {
    name: "Summary",
    widths: [
      width([...input.facts.map((f) => f.label), ...input.kpis.map((k) => k.meta.name)], 24, 40),
      Math.max(18, figureWidth(figures, "currency", symbol)),
      12,
      Math.max(14, figureWidth(figures, "currency", symbol)),
      Math.max(14, figureWidth(figures, "currency", symbol)),
      30,
      70,
    ],
    rows,
  };
}

function chartSheet(chart: WorkbookInput["charts"][number], symbol: string): XlsxSheet {
  const t = chartTable(chart.data);
  const styles = t.formats.map((f, c) =>
    styleOf(
      f,
      t.rows.map((r) => r[c]),
    ),
  );
  // A time axis is written as real dates in the grain's format; quarters keep their label ("Q1 2026").
  const time = t.time && t.time.grain !== "quarter" ? t.time : null;
  const timeStyle: XlsxStyle = time?.grain === "month" ? "month" : time?.grain === "year" ? "year" : "date";
  const body = t.rows.map((r, i): XlsxCell[] => {
    const start = time?.starts[i];
    return typeof start === "number" ? [{ v: excelDate(start), s: timeStyle }, ...r.slice(1)] : r;
  });
  return {
    name: chart.title,
    widths: t.header.map((h, c) =>
      c === 0
        ? width([h, ...t.rows.map((r) => String(r[0] ?? ""))], 14, 40)
        : Math.max(
            width([h], 10, 30),
            figureWidth(
              t.rows.map((r) => r[c]),
              styles[c] ?? "text",
              symbol,
            ),
          ),
    ),
    styles,
    rows: [
      [{ v: chart.title, s: "title" }],
      [{ v: chart.headline ?? "", s: "note" }],
      [],
      t.header.map((h) => ({ v: h, s: "header" as const })),
      ...body,
    ],
    table: { headerRow: 4, columns: t.header.length },
  };
}

function dataSheet(input: WorkbookInput, shownRows: number): XlsxSheet {
  const { ds } = input;
  const role = new Map(input.columns.map((c) => [c.name, c.role]));
  const styles: XlsxStyle[] = ds.columns.map((c) =>
    c.kind === "date"
      ? c.timeOnly
        ? "time"
        : c.hasTime
          ? "datetime"
          : "date"
      : c.kind === "number" && role.get(c.name) === "currency"
        ? "decimal"
        : "text",
  );
  const readers = ds.columns.map((c): ((r: number) => XlsxCell) => {
    switch (c.kind) {
      case "number":
        return (r) => {
          const v = c.values[r] as number;
          return v === v ? v : null;
        };
      case "date":
        return (r) => {
          const v = c.values[r] as number;
          return v !== v ? null : c.timeOnly ? excelTime(v) : excelDate(v);
        };
      case "boolean": {
        // Exports keep the data as written: Yes/No stay words, TRUE/FALSE stay true/false.
        const words = wordLabels(c);
        return (r) => {
          const v = c.values[r] as number;
          return v < 0 ? null : words ? (v === 1 ? words.true : words.false) : v === 1;
        };
      }
      case "string":
        return (r) => {
          const k = c.codes[r] as number;
          return k < 0 ? null : (c.dict[k] as string);
        };
    }
  });
  function* rows(): Generator<XlsxCell[]> {
    yield ds.columns.map((c) => ({ v: c.name, s: "header" as const }));
    for (let i = 0; i < shownRows; i++) {
      const r = input.rows[i] as number;
      yield readers.map((read) => read(r));
    }
  }
  return {
    name: "Data",
    widths: ds.columns.map((c, i) =>
      styles[i] === "datetime"
        ? Math.max(17, width([c.name]))
        : styles[i] === "date"
          ? Math.max(12, width([c.name]))
          : c.kind === "number"
            ? Math.max(width([c.name], 10, 40), figureWidth(c.values, styles[i] ?? "text", ""))
            : width([c.name], 10, 40),
    ),
    styles,
    rows: rows(),
    table: { headerRow: 1, columns: ds.columns.length },
  };
}

function dictionarySheet(rows: DictionaryRow[]): XlsxSheet {
  const header = [
    "Column",
    "Business name",
    "Storage type",
    "Semantic role",
    "Unit",
    "Range",
    "Key",
    "Allowed values",
    "Blank %",
    "Distinct values",
    "Examples",
    "Description",
  ];
  return {
    name: "Dictionary",
    widths: [
      width(
        rows.map((r) => r.column),
        14,
        40,
      ),
      22,
      12,
      16,
      12,
      26,
      6,
      30,
      9,
      10,
      30,
      60,
    ],
    styles: [
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "integer",
    ],
    rows: [
      header.map((h) => ({ v: h, s: "header" as const })),
      ...rows.map((r) => [
        r.column,
        r.businessName,
        r.type,
        r.role,
        r.unit,
        r.range,
        r.key,
        r.allowed,
        r.nullPct,
        r.distinct,
        r.examples,
        r.description,
      ]),
    ],
    table: { headerRow: 1, columns: header.length },
  };
}

/** The workbook as .xlsx bytes. */
export function dashboardWorkbook(input: WorkbookInput): Uint8Array {
  // A sheet holds at most 1,048,576 rows, the header among them.
  const shownRows = Math.min(input.rows.length, XLSX_MAX_ROWS - 1);
  const symbol = currencySymbol(input.currency);
  return xlsxWorkbook(
    [
      summarySheet(input, shownRows, symbol),
      ...input.charts.map((c) => chartSheet(c, symbol)),
      dataSheet(input, shownRows),
      dictionarySheet(input.dictionary),
    ],
    symbol,
  );
}
