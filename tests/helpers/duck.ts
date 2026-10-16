/** Loads a Dataset into native DuckDB (via our own CSV exporter) to execute generated SQL. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { Dataset } from "@/engine/core/types";
import { datasetToCsv } from "@/engine/export/csv";
import { exportKind } from "@/engine/core/booleans";

export async function loadIntoDuckDB(
  ds: Dataset,
  table: string,
  headers: Map<string, string>,
): Promise<DuckDBConnection> {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  const dir = mkdtempSync(join(tmpdir(), "loupe-"));
  const file = join(dir, `${table}.csv`).replace(/\\/g, "/");
  // Raw values (no injection guard) so DuckDB sees exactly what the engine sees.
  writeFileSync(file, datasetToCsv(ds, { headers, guardInjection: false }), "utf8");
  const types = ds.columns
    .map((c) => {
      const t =
        c.kind === "number"
          ? "DOUBLE"
          : c.kind === "date"
            ? c.timeOnly
              ? "TIME"
              : c.hasTime
                ? "TIMESTAMP"
                : "DATE"
            : exportKind(c) === "boolean"
              ? "BOOLEAN"
              : "VARCHAR";
      return `'${(headers.get(c.name) ?? c.name).replace(/'/g, "''")}': '${t}'`;
    })
    .join(", ");
  await conn.run(
    `CREATE TABLE "${table}" AS SELECT * FROM read_csv('${file}', header = true, columns = {${types}}, nullstr = '', quote = '"', escape = '"')`,
  );
  return conn;
}

export async function scalar(conn: DuckDBConnection, sql: string): Promise<number> {
  const reader = await conn.runAndReadAll(sql);
  const rows = reader.getRowObjectsJson() as Array<Record<string, unknown>>;
  const v = rows[0]?.value;
  if (v === null || v === undefined) return NaN;
  return Number(v);
}

export function close(conn: DuckDBConnection): void {
  conn.closeSync();
}
