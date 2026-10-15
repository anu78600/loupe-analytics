/**
 * Small helpers for building demo datasets column by column, plus a seeded
 * shuffle.
 *
 * Each column registration returns a push function. Generators call every
 * push exactly once per row, and finish() throws if the columns end up with
 * different lengths. Values sit in plain arrays until finish() packs them
 * into the typed-array Dataset shape (core/types.ts). Pass dates as
 * wall-clock UTC ms (core/dates.utc) and null for missing values.
 */
import type { Rng } from "@/engine/core/random";
import type { Column, Dataset, NumberFormatInfo } from "@/engine/core/types";

/** Dictionary-encodes strings in first-seen order (null → -1). */
class StrCol {
  private dict: string[] = [];
  private index = new Map<string, number>();
  codes: number[] = [];
  push(v: string | null): void {
    if (v === null) {
      this.codes.push(-1);
      return;
    }
    let c = this.index.get(v);
    if (c === undefined) {
      c = this.dict.length;
      this.index.set(v, c);
      this.dict.push(v);
    }
    this.codes.push(c);
  }
  finish(name: string): Column {
    return { kind: "string", name, codes: Int32Array.from(this.codes), dict: this.dict };
  }
}

type Spec =
  | { kind: "string"; col: StrCol }
  | { kind: "number"; values: number[]; format: NumberFormatInfo }
  | { kind: "date"; values: number[]; hasTime: boolean }
  | { kind: "boolean"; values: number[]; labels: [string, string] };

export class SampleBuilder {
  private specs = new Map<string, Spec>();
  private order: string[] = [];

  string(name: string): (v: string | null) => void {
    const col = new StrCol();
    this.add(name, { kind: "string", col });
    return (v) => col.push(v);
  }

  /** Default format: 2 decimals, not integer; override fields such as { currency: "INR" }. */
  number(name: string, format: Partial<NumberFormatInfo> = {}): (v: number | null) => void {
    const values: number[] = [];
    this.add(name, { kind: "number", values, format: { integer: false, decimals: 2, ...format } });
    return (v) => values.push(v === null ? NaN : v);
  }

  /** `hasTime` sets the column's hasTime flag and its format label. */
  date(name: string, hasTime = false): (v: number | null) => void {
    const values: number[] = [];
    this.add(name, { kind: "date", values, hasTime });
    return (v) => values.push(v === null ? NaN : v);
  }

  boolean(name: string, trueLabel = "Yes", falseLabel = "No"): (v: boolean | null) => void {
    const values: number[] = [];
    this.add(name, { kind: "boolean", values, labels: [trueLabel, falseLabel] });
    return (v) => values.push(v === null ? -1 : v ? 1 : 0);
  }

  private add(name: string, spec: Spec): void {
    this.specs.set(name, spec);
    this.order.push(name);
  }

  /** Assembles the Dataset in registration order, marked as a demo (source kind "sample", isDemo). */
  finish(meta: { id: string; name: string; fileName: string; sampleId: string }): Dataset {
    const columns: Column[] = this.order.map((name) => {
      const s = this.specs.get(name) as Spec;
      switch (s.kind) {
        case "string":
          return s.col.finish(name);
        case "number":
          return { kind: "number", name, values: Float64Array.from(s.values), format: s.format };
        case "date":
          return {
            kind: "date",
            name,
            values: Float64Array.from(s.values),
            hasTime: s.hasTime,
            format: s.hasTime ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD",
          };
        case "boolean":
          return {
            kind: "boolean",
            name,
            values: Int8Array.from(s.values),
            trueLabel: s.labels[0],
            falseLabel: s.labels[1],
          };
      }
    });
    const lengths = new Set(columns.map((c) => (c.kind === "string" ? c.codes.length : c.values.length)));
    if (lengths.size > 1) throw new Error(`Sample ${meta.id} has ragged columns`);
    const rowCount = [...lengths][0] ?? 0;
    return {
      id: meta.id,
      name: meta.name,
      rowCount,
      columns,
      source: {
        fileName: meta.fileName,
        kind: "sample",
        sizeBytes: 0,
        sampleId: meta.sampleId,
        isDemo: true,
      },
    };
  }
}

/** Rounds to 2 decimals (paise/cents). */
export const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Seeded Fisher–Yates shuffle, in place: exactly one draw per position, so
 * the order and the draws consumed are the same in every JavaScript engine
 * (unlike Array#sort with a random comparator, whose result depends on the
 * engine's sort algorithm).
 */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return items;
}
