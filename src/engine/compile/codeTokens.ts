/**
 * Splits SQL or DAX into tokens that say what each piece of text is, so code
 * can be laid out (compile/sqlFormat.ts) and coloured (the app's code views,
 * the SQL PDF and the readable SQL & DAX page) the same way everywhere.
 *
 * The kinds answer the question a reader has: is this the language, or is it
 * mine?
 * - keyword, function: the language itself (SELECT, CASE, CALCULATE, SUM…);
 * - name: the user's table, columns and measures ("net_amount",
 *   'Orders'[net_amount], [Net Revenue]);
 * - string: values from the user's data ('Returned', "Yes");
 * - number, comment, punct (brackets, commas, operators), space;
 * - text: other bare words, such as the aliases a query introduces (base,
 *   leaf1, value).
 *
 * Joining every token's text gives back the input exactly.
 */

export type CodeLanguage = "sql" | "dax";
export type TokenKind =
  "space" | "comment" | "keyword" | "function" | "name" | "string" | "number" | "punct" | "text";

export interface Token {
  kind: TokenKind;
  text: string;
}

const SQL_KEYWORDS = new Set(
  (
    "SELECT FROM WHERE GROUP BY HAVING ORDER ASC DESC NULLS FIRST LAST LIMIT OFFSET WITH AS CREATE VIEW " +
    "TABLE REPLACE AND OR NOT IN IS NULL CASE WHEN THEN ELSE END DISTINCT ON JOIN LEFT RIGHT INNER OUTER " +
    "CROSS FULL UNION ALL EXISTS BETWEEN LIKE ILIKE INTERVAL OVER PARTITION FILTER WITHIN TRUE FALSE " +
    "INSERT INTO VALUES UPDATE SET DELETE DATE TIMESTAMP TIME VARCHAR BIGINT DOUBLE PRECISION BOOLEAN " +
    "INTEGER INT NUMERIC TEXT COPY HEADER FORMAT CSV LOCAL INFILE DATA LOAD FIELDS TERMINATED ENCLOSED " +
    "LINES IGNORE ROWS ROW UNBOUNDED PRECEDING FOLLOWING CURRENT DROP IF"
  ).split(" "),
);

const DAX_KEYWORDS = new Set(
  "DEFINE EVALUATE MEASURE VAR RETURN TABLE COLUMN ORDER BY ASC DESC START AT IN NOT".split(" "),
);

const isWordStart = (c: string) => /[A-Za-z_]/.test(c);
const isDigit = (c: string) => c >= "0" && c <= "9";

/** Reads a quoted run from `i` (the opening quote) to its closing quote; a doubled quote is an escape. */
function quoted(code: string, i: number, close: string): number {
  let j = i + 1;
  while (j < code.length) {
    if (code[j] === close) {
      if (code[j + 1] === close) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return code.length;
}

/** The first character after `i` that isn't white space, or "". */
function nextNonSpace(code: string, i: number): string {
  let j = i;
  while (j < code.length && /\s/.test(code[j] as string)) j++;
  return code[j] ?? "";
}

export function tokenize(code: string, lang: CodeLanguage): Token[] {
  const out: Token[] = [];
  const keywords = lang === "sql" ? SQL_KEYWORDS : DAX_KEYWORDS;
  let i = 0;
  const push = (kind: TokenKind, end: number) => {
    out.push({ kind, text: code.slice(i, end) });
    i = end;
  };
  while (i < code.length) {
    const c = code[i] as string;
    const two = code.slice(i, i + 2);
    if (/\s/.test(c)) {
      let j = i + 1;
      while (j < code.length && /\s/.test(code[j] as string)) j++;
      push("space", j);
    } else if (two === "--" || (lang === "dax" && two === "//")) {
      const nl = code.indexOf("\n", i);
      push("comment", nl < 0 ? code.length : nl);
    } else if (two === "/*") {
      const close = code.indexOf("*/", i + 2);
      push("comment", close < 0 ? code.length : close + 2);
    } else if (c === "'") {
      // SQL: a text value. DAX: a table name.
      push(lang === "sql" ? "string" : "name", quoted(code, i, "'"));
    } else if (c === '"') {
      // SQL: a table or column name. DAX: a text value.
      push(lang === "sql" ? "name" : "string", quoted(code, i, '"'));
    } else if (lang === "dax" && c === "[") {
      push("name", quoted(code, i, "]"));
    } else if (isDigit(c) || (c === "." && isDigit(code[i + 1] ?? ""))) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(code.slice(i));
      push("number", i + (m?.[0].length ?? 1));
    } else if (isWordStart(c)) {
      const m = (lang === "dax" ? /^[A-Za-z_][A-Za-z0-9_.]*/ : /^[A-Za-z_][A-Za-z0-9_]*/).exec(code.slice(i));
      const word = m?.[0] ?? c;
      const upper = word.toUpperCase();
      const end = i + word.length;
      const kind: TokenKind = keywords.has(upper)
        ? "keyword"
        : nextNonSpace(code, end) === "("
          ? "function"
          : lang === "dax" && (upper === "TRUE" || upper === "FALSE")
            ? "keyword"
            : "text";
      push(kind, end);
    } else {
      const op = /^(?:&&|\|\||<=|>=|<>|!=|::)/.exec(code.slice(i));
      push("punct", i + (op?.[0].length ?? 1));
    }
  }
  return out;
}
