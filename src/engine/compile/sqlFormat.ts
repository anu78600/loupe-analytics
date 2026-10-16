/**
 * Lays out generated SQL for people to read. The compiler (compile/sql.ts)
 * writes each KPI's value as one expression, which for a filtered ratio can
 * run to several hundred characters on a single line. prettySql() leaves
 * every line that already fits alone and re-flows only the long ones:
 *
 *   SELECT (
 *     COUNT(
 *       DISTINCT CASE
 *         WHEN "order_status" IN ('RTO')
 *         THEN "order_id"
 *       END
 *     ) * 1.0
 *     / NULLIF(…, 0)
 *   ) AS value
 *
 * - A bracket whose contents don't fit opens on its line and closes on its
 *   own, its contents two spaces in.
 * - Inside, a list breaks after each comma, a condition before each AND/OR,
 *   a sum before each / + −; CASE puts WHEN, THEN and ELSE on their own
 *   lines and END under CASE.
 *
 * Only white space changes: the tokens, in order, are exactly the input's
 * (tests/sql-format.test.ts checks this and runs the result in DuckDB).
 * Lines with a comment or unbalanced brackets are left as they are.
 *
 * The compiler's own output stays on one line, because other code reads it
 * as text (export/sqlFile.ts singleAggregate). Format where SQL leaves the
 * engine: the KPI details, question answers, the SQL file and the
 * verification queries.
 */
import { tokenize } from "./codeTokens";

/** Lines are kept within this many characters where the tokens allow. */
export const SQL_WIDTH = 92;

interface Atom {
  t: "atom";
  text: string;
  /** Whether white space came before it in the input. */
  space: boolean;
}
interface Group {
  t: "group";
  items: Item[];
  /** White space before "(", and before ")". */
  space: boolean;
  closeSpace: boolean;
}
type Item = Atom | Group;

const BREAK_BEFORE_LOGIC = new Set(["AND", "OR"]);
const CASE_PARTS = new Set(["WHEN", "THEN", "ELSE"]);

/** Atoms with spacing, nested by brackets; null when the brackets don't balance. */
function parse(line: string): Item[] | null {
  const root: Item[] = [];
  const stack: Group[] = [];
  let space = false;
  for (const tok of tokenize(line, "sql")) {
    if (tok.kind === "space") {
      space = true;
      continue;
    }
    const into = stack.length ? (stack[stack.length - 1] as Group).items : root;
    if (tok.text === "(") {
      const g: Group = { t: "group", items: [], space, closeSpace: false };
      into.push(g);
      stack.push(g);
    } else if (tok.text === ")") {
      const g = stack.pop();
      if (!g) return null;
      g.closeSpace = space;
    } else {
      into.push({ t: "atom", text: tok.text, space });
    }
    space = false;
  }
  return stack.length ? null : root;
}

const upper = (it: Item | undefined) => (it?.t === "atom" ? it.text.toUpperCase() : "");

/** The items as written, on one line. */
function flat(items: Item[]): string {
  let s = "";
  items.forEach((it, i) => {
    if (i && it.space) s += " ";
    s +=
      it.t === "atom"
        ? it.text
        : `(${it.items.length && it.items[0]?.space ? " " : ""}${flat(it.items)}${it.closeSpace ? " " : ""})`;
  });
  return s;
}

/** Whether a + or − at `i` joins two values (rather than signing a number): it follows a value. */
function isBinary(items: Item[], i: number): boolean {
  const prev = items[i - 1];
  if (!prev) return false;
  if (prev.t === "group") return true;
  const tok = tokenize(prev.text, "sql")[0];
  if (!tok || tok.kind === "punct") return false;
  return tok.kind === "keyword" ? /^(?:END|NULL|TRUE|FALSE)$/i.test(prev.text) : true;
}

class Printer {
  lines: string[] = [];
  line: string;
  constructor(
    indent: string,
    readonly width: number,
  ) {
    this.line = indent;
  }
  get col(): number {
    return this.line.length;
  }
  write(s: string): void {
    this.line += s;
  }
  newline(indent: number): void {
    this.lines.push(this.line.trimEnd());
    this.line = " ".repeat(indent);
  }
  done(): string {
    this.lines.push(this.line.trimEnd());
    return this.lines.join("\n");
  }
}

/** Index of the END closing the CASE at `start`, at the same bracket level. */
function caseEnd(items: Item[], start: number): number {
  let depth = 0;
  for (let i = start; i < items.length; i++) {
    const u = upper(items[i]);
    if (u === "CASE") depth++;
    else if (u === "END" && --depth === 0) return i;
  }
  return -1;
}

/** A bracket: on the current line when it fits, else opened, its contents indented, and closed on its own line. */
function emitGroup(g: Group, indent: number, p: Printer, room: number): void {
  const inner = flat(g.items);
  p.write("(");
  if (p.col + inner.length + 1 + room <= p.width) {
    p.write(`${g.items[0]?.space ? " " : ""}${inner}${g.closeSpace ? " " : ""})`);
    return;
  }
  p.newline(indent + 2);
  emitSeq(g.items, indent + 2, p, true);
  p.newline(indent);
  p.write(")");
}

/** CASE … END: on one line when it fits, else WHEN/THEN/ELSE two spaces in and END under CASE. */
function emitCase(items: Item[], indent: number, p: Printer): void {
  const all = flat(items);
  if (p.col + all.length <= p.width) {
    p.write(all);
    return;
  }
  p.write((items[0] as Atom).text);
  const body = items.slice(1, -1);
  let clause: Item[] = [];
  const flush = () => {
    if (!clause.length) return;
    p.newline(indent + 2);
    p.write((clause[0] as Atom).text);
    const rest = clause.slice(1);
    if (rest.length) {
      p.write(" ");
      emitSeq(
        rest.map((it, i) => (i === 0 ? { ...it, space: false } : it)),
        indent + 2,
        p,
        null,
      );
    }
    clause = [];
  };
  for (const it of body) {
    if (CASE_PARTS.has(upper(it))) flush();
    clause.push(it);
  }
  flush();
  p.newline(indent);
  p.write((items[items.length - 1] as Atom).text);
}

/**
 * A run of items at one bracket level. `broken` true breaks at every comma,
 * AND/OR and + − /; null decides by whether the run fits on the current line.
 */
function emitSeq(items: Item[], indent: number, p: Printer, broken: boolean | null): void {
  const breaks = broken ?? p.col + flat(items).length > p.width;
  for (let i = 0; i < items.length; i++) {
    const it = items[i] as Item;
    const u = upper(it);
    const prev = items[i - 1];
    if (i && breaks && prev?.t === "atom" && prev.text === ",") p.newline(indent);
    else if (i && breaks && BREAK_BEFORE_LOGIC.has(u)) p.newline(indent + 2);
    else if (i && breaks && it.t === "atom" && /^[/+-]$/.test(it.text) && isBinary(items, i))
      p.newline(indent);
    else if (i && it.space) p.write(" ");
    if (u === "CASE") {
      const end = caseEnd(items, i);
      if (end > i) {
        emitCase(items.slice(i, end + 1), indent, p);
        i = end;
        continue;
      }
    }
    if (it.t === "atom") p.write(it.text);
    else {
      // Room for what must follow on this line: a comma or a closing word such as AS value.
      const next = items[i + 1];
      const room = next?.t === "atom" && !next.space ? next.text.length : 0;
      emitGroup(it, indent, p, room);
    }
  }
}

function reflow(line: string, width: number): string {
  if (line.length <= width || /--|\/\*/.test(line.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, ""))) return line;
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const items = parse(line.slice(indent.length));
  if (!items?.length) return line;
  const p = new Printer(indent, width);
  emitSeq(items, indent.length, p, null);
  return p.done();
}

/** `sql` with every over-long line laid out over several (white space only; see the file header). */
export function prettySql(sql: string, width = SQL_WIDTH): string {
  return sql
    .split("\n")
    .map((line) => reflow(line, width))
    .join("\n");
}
