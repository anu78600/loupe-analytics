/**
 * kpis-sql-and-dax.html: every KPI's SQL and DAX in colour, to read rather
 * than to run. The .sql and .dax files are plain text, and a plain-text
 * editor such as Notepad shows them in one colour; this page is what to open
 * to understand them.
 *
 * - The colours follow the app's code views (ui/common/code.tsx, tokens from
 *   compile/codeTokens.ts): the SQL/DAX language in blue and violet, the
 *   user's own table and columns in brass, values from their data in green,
 *   numbers in orange, notes in grey. A key at the top says so.
 * - KPIs are grouped by topic with a contents list; each shows its meaning,
 *   formula, Loupe's value at export, and its SQL and DAX side by side.
 * - The SQL is the same as kpis.sql (laid out by prettySql) and the DAX the
 *   same as measures.dax (buildMeasures), so the page never disagrees with
 *   the files.
 *
 * One self-contained file (inline CSS, no scripts, fonts or links to other
 * hosts), light or dark with the reader's system setting. Its colours repeat
 * the --code-* tokens of tokens.css, since a downloaded file can't read them.
 */
import { formatValue } from "@/engine/core/format";
import { tokenize, type CodeLanguage, type TokenKind } from "@/engine/compile/codeTokens";
import { kpiQuery, quoteIdent } from "@/engine/compile/sql";
import { prettySql } from "@/engine/compile/sqlFormat";
import { daxMeasureName } from "@/engine/compile/dax";
import { makeSqlContext } from "@/engine/kpi/context";
import { exportKpiIds, type ExportContext } from "./context";
import { buildMeasures } from "./daxFile";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CLASS: Partial<Record<TokenKind, string>> = {
  keyword: "k",
  function: "f",
  name: "n",
  string: "s",
  number: "d",
  comment: "c",
};

/** The code as HTML, each token wrapped in its colour's class. */
function highlight(code: string, lang: CodeLanguage): string {
  return tokenize(code, lang)
    .map((t) => {
      const cls = CLASS[t.kind];
      return cls ? `<span class="${cls}">${esc(t.text)}</span>` : esc(t.text);
    })
    .join("");
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const STYLE = `
:root{color-scheme:light dark;--bg:#f7f6f2;--card:#ffffff;--code:#f1efea;--fg:#121417;--muted:#575d66;--subtle:#636a73;--line:rgba(18,20,23,.1);--accent:#816226;
--k:#2c56c9;--f:#7535b0;--n:#835600;--s:#1a7239;--d:#a84d05;--c:#636a73}
@media (prefers-color-scheme:dark){:root{--bg:#0b0c0e;--card:#121418;--code:#0e0f12;--fg:#edeef0;--muted:#9ba1a9;--subtle:#828a96;--line:rgba(255,255,255,.08);--accent:#d6b47a;
--k:#7aa2f7;--f:#bb9af7;--n:#e3b766;--s:#79cf95;--d:#f2a06a;--c:#828a96}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1200px;margin:0 auto;padding:40px 20px 64px}
h1{font:600 30px/1.15 Georgia,"Times New Roman",serif;letter-spacing:-.01em;margin:0}
h2{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:44px 0 12px;font-weight:600}
h3{font-size:17px;margin:0;font-weight:600}
.meta{color:var(--muted);margin:6px 0 0}
.key{display:flex;flex-wrap:wrap;gap:8px 18px;margin:22px 0 0;padding:12px 16px;border:1px solid var(--line);border-radius:12px;background:var(--card);font-size:13px;color:var(--muted)}
.key span{display:inline-flex;align-items:center;gap:7px}
.key i{width:10px;height:10px;border-radius:3px;display:inline-block}
nav{margin:18px 0 0;font-size:13px;color:var(--muted)}
nav p{margin:6px 0}
nav b{color:var(--fg);font-weight:600;margin-right:6px}
nav a{color:var(--muted);text-decoration:none;margin-right:12px;white-space:nowrap}
nav a:hover{color:var(--accent)}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px 22px;margin:12px 0}
.kpi header{display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap}
.value{font:600 17px ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;color:var(--accent)}
.value small{font:12px system-ui,sans-serif;color:var(--subtle);margin-left:6px}
.def{margin:6px 0 0;color:var(--muted)}
.formula{margin:4px 0 0;font-size:13px;color:var(--subtle)}
.grid{display:grid;gap:12px;margin-top:16px}
@media (min-width:1000px){.grid{grid-template-columns:1fr 1fr}}
figure{margin:0;min-width:0;border:1px solid var(--line);border-radius:12px;overflow:hidden}
figcaption{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--subtle);padding:7px 12px;border-bottom:1px solid var(--line);background:var(--card)}
pre{margin:0;padding:12px 14px;background:var(--code);overflow:auto;font:12.5px/1.6 ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;tab-size:4}
.k{color:var(--k);font-weight:600}.f{color:var(--f)}.n{color:var(--n)}.s{color:var(--s)}.d{color:var(--d)}.c{color:var(--c);font-style:italic}
footer{margin-top:40px;color:var(--subtle);font-size:13px;border-top:1px solid var(--line);padding-top:16px}
@media print{body{background:#fff}.kpi,figure{break-inside:avoid}}
`;

interface Entry {
  id: string;
  name: string;
  topic: string;
  definition: string;
  formula: string;
  value: string;
  sql: string | null;
  dax: string | null;
}

/** The page's HTML. `symbol` is the trimmed currency symbol, as for measures.dax. */
export function generateCodeHtml(ctx: ExportContext, symbol: string): string {
  const sqlCtx = makeSqlContext(ctx.ds, ctx.mapping, ctx.res, ctx.names);
  const table = quoteIdent(ctx.names.table.toLowerCase());
  const measures = new Map(buildMeasures(ctx, symbol).map((m) => [m.id, m]));
  const fmt = { locale: ctx.locale, currency: ctx.currency };

  const entries: Entry[] = [];
  for (const id of exportKpiIds(ctx)) {
    const r = ctx.res.get(id);
    if (!r?.available || !r.variant) continue;
    let sql: string | null;
    try {
      sql = prettySql(kpiQuery(r.variant.expr, { ...sqlCtx, table }));
    } catch {
      sql = null;
    }
    const m = measures.get(id);
    const v = ctx.kpiValues.get(id);
    entries.push({
      id,
      name: ctx.names.measures.get(id) ?? r.def.name,
      topic: r.def.hidden || r.dependencyOnly ? "Helpers" : (r.def.group ?? "Other"),
      definition: r.def.definition,
      formula: r.def.formula,
      value: v !== undefined && v !== null ? formatValue(v, r.def.format, fmt) : "",
      sql,
      dax: m ? `${daxMeasureName(m.name)} =\n${m.expression.replace(/^/gm, "    ")}` : null,
    });
  }
  // Topics in the order they first appear, helpers last.
  const topics = [...new Set(entries.map((e) => e.topic))].sort(
    (a, b) => Number(a === "Helpers") - Number(b === "Helpers"),
  );

  const contents = topics
    .map(
      (t) =>
        `<p><b>${esc(t)}</b>${entries
          .filter((e) => e.topic === t)
          .map((e) => `<a href="#${esc(slug(e.id))}">${esc(e.name)}</a>`)
          .join(" ")}</p>`,
    )
    .join("");

  const sections = topics
    .map((t) => {
      const cards = entries
        .filter((e) => e.topic === t)
        .map(
          (e) => `<section class="kpi" id="${esc(slug(e.id))}">
<header><h3>${esc(e.name)}</h3>${e.value ? `<span class="value">${esc(e.value)}<small>Loupe, whole file</small></span>` : ""}</header>
<p class="def">${esc(e.definition)}</p>
<p class="formula">Formula: ${esc(e.formula)}</p>
<div class="grid">
${e.sql ? `<figure><figcaption>SQL · DuckDB / PostgreSQL</figcaption><pre><code>${highlight(e.sql, "sql")}</code></pre></figure>` : `<figure><figcaption>SQL</figcaption><pre><code><span class="c">Not expressible in portable SQL.</span></code></pre></figure>`}
${e.dax ? `<figure><figcaption>DAX · Power BI measure</figcaption><pre><code>${highlight(e.dax, "dax")}</code></pre></figure>` : ""}
</div>
</section>`,
        )
        .join("\n");
      return `<h2>${esc(t)}</h2>\n${cards}`;
    })
    .join("\n");

  const title = `SQL & DAX · ${ctx.ds.source.fileName}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p class="meta">${esc(ctx.domain.name)}${ctx.subDomain ? ` › ${esc(ctx.subDomain.name)}` : ""} · ${ctx.ds.rowCount.toLocaleString("en-US")} rows · ${entries.length} KPIs · generated by Loupe on ${esc(ctx.generatedAt)}</p>
<div class="key" aria-label="What the colours mean">
<span><i style="background:var(--k)"></i>The SQL / DAX language</span>
<span><i style="background:var(--f)"></i>Its functions</span>
<span><i style="background:var(--n)"></i>Your table and columns</span>
<span><i style="background:var(--s)"></i>Values from your data</span>
<span><i style="background:var(--d)"></i>Numbers</span>
<span><i style="background:var(--c)"></i>Notes</span>
</div>
<nav aria-label="Contents">${contents}</nav>
${sections}
<footer>Values are Loupe's own, over the whole file, at export. The SQL is the same as kpis.sql (it runs as written on DuckDB and PostgreSQL; kpis.sql lists the changes for other databases), and the DAX the same as measures.dax, which adds these measures to Power BI.</footer>
</main>
</body>
</html>
`;
}
