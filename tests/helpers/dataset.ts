/** Small helpers for reading typed columnar datasets in tests. */
import type { Column, Dataset } from "@/engine/core/types";
import { ingestFile } from "@/engine/parse";
import type { IngestOptions, ParseReport } from "@/engine/core/types";

export function column(ds: Dataset, name: string): Column {
  const col = ds.columns.find((c) => c.name === name);
  if (!col) throw new Error(`No column "${name}". Have: ${ds.columns.map((c) => c.name).join(", ")}`);
  return col;
}

/** The JS value of one cell: number | string | boolean | null (dates as wall-clock UTC ms). */
export function cell(ds: Dataset, name: string, row: number): number | string | boolean | null {
  const col = column(ds, name);
  switch (col.kind) {
    case "number":
    case "date": {
      const v = col.values[row] as number;
      return Number.isNaN(v) ? null : v;
    }
    case "string": {
      const code = col.codes[row] as number;
      return code < 0 ? null : (col.dict[code] as string);
    }
    case "boolean": {
      const v = col.values[row] as number;
      return v < 0 ? null : v === 1;
    }
  }
}

/** Parses an in-memory file through the same entry point the worker uses. */
export async function parse(
  content: string | Uint8Array,
  fileName: string,
  opts: IngestOptions = {},
): Promise<{ ds: Dataset; report: ParseReport }> {
  const blob = new Blob([content as BlobPart]);
  const out = await ingestFile(blob, fileName, opts);
  if (out.status !== "ok") throw new Error(`Expected a dataset, got ${out.status}`);
  return { ds: out.dataset, report: out.report };
}
