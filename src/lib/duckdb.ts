"use client";

/**
 * DuckDB-WASM, loaded only on demand (≈7 MB from jsDelivr). Used to re-run the
 * exported SQL against the same data and prove it matches the engine, and for
 * the ad-hoc SQL lab. The dashboard itself never waits for it.
 *
 * Only DuckDB's code is fetched from the CDN; the data is handed to it as an
 * in-memory file buffer and never leaves the browser. One database (and its
 * own worker) is shared per tab and survives across calls; each
 * verification reloads the table from a fresh engine bundle.
 */
import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

/** One KPI query from Session.verificationBundle(); `engine` is Loupe's own value for it. */
export interface VerificationQuery {
  id: string;
  name: string;
  sql: string;
  engine: number | null;
}

/** Engine vs DuckDB for one KPI. `error` is set (and `match` false) when the query failed. */
export interface VerificationResult {
  id: string;
  name: string;
  engine: number | null;
  duckdb: number | null;
  match: boolean;
  error?: string;
  sql: string;
}

let dbPromise: Promise<{ db: AsyncDuckDB; worker: Worker }> | null = null;
/** Name of the table loadTable() last created; runSql() refuses to run before one exists. */
let loadedTable: string | null = null;

/** The shared database, created on first use. A failed start is forgotten so the next call retries. */
async function getDb(onStatus?: (s: string) => void): Promise<{ db: AsyncDuckDB; worker: Worker }> {
  if (!dbPromise) {
    dbPromise = (async () => {
      onStatus?.("Downloading DuckDB-WASM (first time only)…");
      const duckdb = await import("@duckdb/duckdb-wasm");
      // Picks the best build this browser supports from jsDelivr.
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
      // Browsers refuse a cross-origin script as a Worker URL, so start the
      // worker from a same-origin Blob that importScripts() the CDN file.
      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
      );
      const worker = new Worker(workerUrl);
      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      onStatus?.("Starting DuckDB…");
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      URL.revokeObjectURL(workerUrl);
      return { db, worker };
    })().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

// 64-bit integers arrive as JS bigint; anything else non-numeric goes through Number(String(v)).
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
}

// Relative tolerance of 1e-6 (absolute below 1) absorbs float summation order.
// NULL vs 0 counts as a match: SQL aggregates over no rows give NULL where
// the engine may give 0.
const closeEnough = (a: number | null, b: number | null): boolean => {
  if (a === null && b === null) return true;
  if (a === null || b === null) return Math.abs((a ?? b) as number) < 1e-9;
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
};

/**
 * (Re)creates `bundle.table` from the CSV bytes and returns an open
 * connection, which the caller must close. Replaces any earlier copy.
 */
export async function loadTable(
  bundle: { csv: Uint8Array; table: string; columns: Array<{ name: string; type: string }> },
  onStatus?: (s: string) => void,
): Promise<AsyncDuckDBConnection> {
  const { db } = await getDb(onStatus);
  onStatus?.("Loading your data into DuckDB…");
  // An in-memory virtual file inside DuckDB's worker; nothing is uploaded.
  await db.registerFileBuffer("loupe_data.csv", bundle.csv);
  const conn = await db.connect();
  // Explicit column types instead of sniffing, blank cells as NULL and
  // RFC 4180 quoting: read the file exactly as the engine wrote it.
  const cols = bundle.columns.map((c) => `'${c.name.replace(/'/g, "''")}': '${c.type}'`).join(", ");
  await conn.query(`DROP TABLE IF EXISTS "${bundle.table}"`);
  await conn.query(
    `CREATE TABLE "${bundle.table}" AS SELECT * FROM read_csv('loupe_data.csv', header = true, columns = {${cols}}, nullstr = '', quote = '"', escape = '"')`,
  );
  loadedTable = bundle.table;
  return conn;
}

/**
 * Loads the bundle and runs every KPI query, comparing DuckDB's answer with
 * the engine's. A failing query is recorded as a mismatch with its error;
 * it never aborts the rest. Throws only if DuckDB itself cannot start or load.
 */
export async function verifySql(
  bundle: {
    csv: Uint8Array;
    table: string;
    columns: Array<{ name: string; type: string }>;
    queries: VerificationQuery[];
  },
  onStatus?: (s: string) => void,
): Promise<VerificationResult[]> {
  const conn = await loadTable(bundle, onStatus);
  const out: VerificationResult[] = [];
  try {
    for (const q of bundle.queries) {
      onStatus?.(`Running ${q.name}…`);
      try {
        // Wrap the exported query unchanged; the cast gives one comparable DOUBLE whatever the SQL type.
        const res = await conn.query(`SELECT CAST(value AS DOUBLE) AS value FROM (${q.sql}) AS kpi`);
        const row = res.toArray()[0] as { value?: unknown } | undefined;
        const v = toNumber(row?.value);
        out.push({
          id: q.id,
          name: q.name,
          engine: q.engine,
          duckdb: v,
          match: closeEnough(q.engine, v),
          sql: q.sql,
        });
      } catch (e) {
        out.push({
          id: q.id,
          name: q.name,
          engine: q.engine,
          duckdb: null,
          match: false,
          error: (e as Error).message,
          sql: q.sql,
        });
      }
    }
  } finally {
    await conn.close();
  }
  return out;
}

/**
 * The SQL lab query with its row cap applied in SQL, so DuckDB stops after
 * `limit` rows instead of handing the whole result to JavaScript. Trailing
 * semicolons are dropped (they are not allowed inside a subquery) and the
 * query sits on its own lines, so a trailing `-- comment` cannot swallow the
 * closing parenthesis.
 */
export function limitedQuery(sql: string, limit: number): string {
  const body = sql.trim().replace(/[;\s]+$/, "");
  return `SELECT * FROM (\n${body}\n) AS lab LIMIT ${Math.max(0, Math.floor(limit))}`;
}

/**
 * Runs an arbitrary read query against the loaded table (SQL lab).
 * Nothing enforces read-only, but the database is a private in-memory copy.
 * At most `limit` rows come back: the query is wrapped with a LIMIT (see
 * limitedQuery). Statements that cannot be wrapped (PRAGMA, DDL, several
 * statements) run as written, and their rows are capped afterwards. Values
 * are flattened for display: bigint → number, Date → "YYYY-MM-DD HH:MM:SS" (UTC).
 */
export async function runSql(
  sql: string,
  limit = 200,
): Promise<{ columns: string[]; rows: Array<Array<string | number | null>> }> {
  if (!loadedTable) throw new Error("Load the data first (Verify SQL does this).");
  const { db } = await getDb();
  const conn = await db.connect();
  try {
    // A statement that cannot be wrapped, or a genuine error: run it as written,
    // so any error the user sees is about their own SQL, not the wrapper.
    const res = await conn.query(limitedQuery(sql, limit)).catch(() => conn.query(sql));
    const columns = res.schema.fields.map((f) => f.name);
    const rows = res
      .toArray()
      .slice(0, limit)
      .map((r) =>
        columns.map((c) => {
          const v = (r as Record<string, unknown>)[c];
          if (v === null || v === undefined) return null;
          if (typeof v === "bigint") return Number(v);
          if (typeof v === "number") return v;
          if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
          return String(v);
        }),
      );
    return { columns, rows };
  } finally {
    await conn.close();
  }
}
