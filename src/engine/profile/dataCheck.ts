/**
 * Data check for step 3 ("Check & map"): the whole file, cell by cell, with
 * every problem marked, so the user can confirm the upload is right before
 * the dashboard is built.
 *
 * A cell is marked when:
 * - the parser couldn't read it as the column's type (its original text is
 *   kept on the column, see UnreadableCells, and shown here);
 * - it breaks one of the health checks' value rules (a negative quantity, a
 *   date after today, a 1 Jan 1900 placeholder, an impossible age, a
 *   different spelling of a category, a discount above the price…), using
 *   exactly the rules of quality.ts, so every count here equals the health
 *   issue's count;
 * - it is blank in a column that is otherwise at least 95% filled and isn't
 *   an optional field (a blank there is probably missing data).
 * A row is marked when it repeats an earlier row in every column.
 *
 * Views list the rows to look at: all rows, "rows to check" (any problem
 * above except value rules the health check only reports for information),
 * one view per health issue with row-level evidence, and the blanks of each
 * column. Row lists are built on first use and cached.
 */
import { unreadableAt, type Dataset } from "@/engine/core/types";
import type { DatasetProfile } from "./types";
import {
  duplicateRowsOf,
  isOptionalColumn,
  issueCellTest,
  type HealthIssue,
  type HealthReport,
} from "./quality";

export type CellProblemKind = "unreadable" | "value" | "blank";

/** A marked cell: its column (dataset order), what is wrong, and a sentence for the tooltip. */
export interface CellProblem {
  column: number;
  kind: CellProblemKind;
  note: string;
  tone: "warning" | "info";
}

export interface CheckedRow {
  /** 0-based row index in the file. */
  index: number;
  /** Display text per column (dataset order); null for blank. */
  cells: Array<string | null>;
  problems: CellProblem[];
  /** 0-based index of the earlier identical row, when this row repeats one. */
  duplicateOf?: number;
}

export interface CheckView {
  id: string;
  label: string;
  detail: string;
  /** Rows the view shows. */
  rows: number;
  tone: "warning" | "info" | "neutral";
  column?: string;
}

/** A blank counts as probably missing when the column is at least this filled. */
const FILLED = 0.95;

interface ValueRule {
  issue: HealthIssue;
  column: number;
  test: (row: number) => boolean;
  note: (row: number) => string;
  tone: "warning" | "info";
}

export class DataCheck {
  private readonly rules: ValueRule[] = [];
  /** Columns (dataset order) whose blanks are probably missing values. */
  private readonly suspectBlanks = new Set<number>();
  private dupOf: Int32Array | null = null;
  private readonly lists = new Map<string, Int32Array>();
  private viewList: CheckView[] | null = null;

  /**
   * `cellText` renders one cell for display (the session's preview format),
   * null for blank.
   */
  constructor(
    private readonly ds: Dataset,
    private readonly profile: DatasetProfile,
    private readonly health: HealthReport,
    private readonly cellText: (column: number, row: number) => string | null,
  ) {
    for (const issue of health.issues) {
      const t = issueCellTest(issue, ds, profile);
      const column = t ? profile.columns.findIndex((c) => c.name === t.column) : -1;
      if (t && column >= 0)
        this.rules.push({
          issue,
          column: profile.columns[column]?.index ?? column,
          test: t.test,
          note: t.note,
          tone: issue.severity === "info" ? "info" : "warning",
        });
    }
    for (const p of profile.columns)
      if (p.nullCount > 0 && 1 - p.nullPct >= FILLED && !isOptionalColumn(p)) this.suspectBlanks.add(p.index);
  }

  private duplicates(): Int32Array {
    return (this.dupOf ??= duplicateRowsOf(this.ds));
  }

  private isBlank(column: number, row: number): boolean {
    const c = this.ds.columns[column];
    if (!c) return false;
    switch (c.kind) {
      case "string":
        return (c.codes[row] as number) < 0;
      case "boolean":
        return (c.values[row] as number) < 0;
      default: {
        const v = c.values[row] as number;
        return v !== v;
      }
    }
  }

  /** Rows matching `test`, ascending. */
  private collect(test: (row: number) => boolean): Int32Array {
    const out: number[] = [];
    for (let r = 0; r < this.ds.rowCount; r++) if (test(r)) out.push(r);
    return Int32Array.from(out);
  }

  /** Every view with its row count, built once. */
  views(): CheckView[] {
    if (this.viewList) return this.viewList;
    const ds = this.ds;
    const views: CheckView[] = [];
    const dup = this.duplicates();
    const unreadable = ds.columns.map((c) => c.unreadable);

    // Rows to check: anything wrong except information-only value rules.
    const warnRules = this.rules.filter((r) => r.tone === "warning");
    const problems = this.collect((r) => {
      if ((dup[r] as number) >= 0) return true;
      for (const rule of warnRules) if (rule.test(r)) return true;
      for (const c of this.suspectBlanks)
        if (this.isBlank(c, r) && !unreadableAt(unreadable[c], r)) return true;
      return false;
    });
    // Unreadable rows are merged in separately: positions are sparse, so no per-row scan is needed.
    const merged = new Set(problems);
    for (const u of unreadable) if (u) for (const r of u.rows) merged.add(r);
    const problemRows = Int32Array.from([...merged].sort((a, b) => a - b));
    this.lists.set("problems", problemRows);

    views.push({
      id: "all",
      label: "All rows",
      detail: "Every row of your file.",
      rows: ds.rowCount,
      tone: "neutral",
    });
    views.push({
      id: "problems",
      label: "Rows to check",
      detail: problemRows.length
        ? "Rows with a cell that couldn't be read, a value that breaks a rule, a probably missing value, or a repeat of an earlier row."
        : "Nothing found that needs checking.",
      rows: problemRows.length,
      tone: problemRows.length ? "warning" : "neutral",
    });

    for (const issue of this.health.issues) {
      let list: Int32Array | null = null;
      if (issue.id === "duplicates") list = this.collect((r) => (dup[r] as number) >= 0);
      else if (issue.id.startsWith("mixed-")) {
        const u = ds.columns.find((c) => c.name === issue.column)?.unreadable;
        if (u) list = Int32Array.from(new Set(u.rows));
      } else {
        const rule = this.rules.find((r) => r.issue === issue);
        if (rule) list = this.collect(rule.test);
      }
      if (!list || !list.length) continue;
      const id = `issue:${issue.id}`;
      this.lists.set(id, list);
      views.push({
        id,
        label: issue.id.startsWith("mixed-") ? `Couldn't be read in "${issue.column}"` : issue.title,
        detail: issue.detail,
        rows: list.length,
        tone: issue.severity === "info" ? "info" : "warning",
        ...(issue.column ? { column: issue.column } : {}),
      });
    }

    for (const p of this.profile.columns) {
      if (p.nullCount <= 0 || p.nullPct >= 0.999) continue;
      const suspect = this.suspectBlanks.has(p.index);
      views.push({
        id: `blank:${p.name}`,
        label: `Blanks in "${p.name}"`,
        detail: suspect
          ? `${p.nullCount.toLocaleString("en-US")} blank cells in a column that is otherwise filled: probably missing values.`
          : `${p.nullCount.toLocaleString("en-US")} blank cells${isOptionalColumn(p) ? ", expected for a field that only applies to some rows" : ""}.`,
        rows: p.nullCount,
        tone: suspect ? "warning" : "info",
        column: p.name,
      });
    }
    this.viewList = views;
    return views;
  }

  /** Row indices of a view; null for "all". */
  private rowsOf(viewId: string): Int32Array | null {
    if (viewId === "all") return null;
    this.views();
    const cached = this.lists.get(viewId);
    if (cached) return cached;
    if (viewId.startsWith("blank:")) {
      const p = this.profile.columns.find((c) => c.name === viewId.slice(6));
      if (!p) return new Int32Array(0);
      const list = this.collect((r) => this.isBlank(p.index, r));
      this.lists.set(viewId, list);
      return list;
    }
    return new Int32Array(0);
  }

  /** Rows `start` … `start + count − 1` of a view, with their cells and problems. */
  rows(viewId: string, start: number, count: number): { total: number; rows: CheckedRow[] } {
    const list = this.rowsOf(viewId);
    const total = list ? list.length : this.ds.rowCount;
    const end = Math.min(total, start + count);
    const dup = this.duplicates();
    const out: CheckedRow[] = [];
    for (let i = Math.max(0, start); i < end; i++) {
      const r = list ? (list[i] as number) : i;
      const problems: CellProblem[] = [];
      const cells = this.ds.columns.map((c, j) => {
        const text = unreadableAt(c.unreadable, r);
        if (text !== undefined) {
          problems.push({
            column: j,
            kind: "unreadable",
            note: `Couldn't be read as ${c.kind === "number" ? "a number" : c.kind === "date" ? "a date" : "yes/no"}: the file says "${text}". It is treated as blank.`,
            tone: "warning",
          });
          return text;
        }
        if (this.suspectBlanks.has(j) && this.isBlank(j, r)) {
          const p = this.profile.columns.find((x) => x.index === j);
          problems.push({
            column: j,
            kind: "blank",
            note: `Blank, although ${Math.round((1 - (p?.nullPct ?? 0)) * 1000) / 10}% of this column is filled: probably a missing value.`,
            tone: "warning",
          });
        }
        return this.cellText(j, r);
      });
      for (const rule of this.rules)
        if (rule.test(r))
          problems.push({ column: rule.column, kind: "value", note: rule.note(r), tone: rule.tone });
      const d = dup[r] as number;
      out.push({ index: r, cells, problems, ...(d >= 0 ? { duplicateOf: d } : {}) });
    }
    return { total, rows: out };
  }
}
