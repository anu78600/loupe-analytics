/**
 * SQL and DAX in colour, so a reader can tell the language from their own
 * data at a glance (tokens from engine/compile/codeTokens.ts, colours from the
 * --code-* tokens in tokens.css, both themes):
 * - blue: the language's words (SELECT, CASE, VAR…); violet: its functions;
 * - gold: your table, columns and measures;
 * - green: values from your data ('Returned', "Yes"); orange: numbers;
 * - grey: notes (upright: Geist Mono ships no italic, and a slant the
 *   browser makes up looks broken).
 * The code is set in Geist Mono, the one place in the app it is used besides
 * the AI request's payload (docs/DESIGN.md "Type").
 *
 * <HighlightedCode> colours a block of code; <CodeLegend> names the colours
 * once wherever code is shown.
 */
import * as React from "react";
import { tokenize, type CodeLanguage, type TokenKind } from "@/engine/compile/codeTokens";
import { cn } from "@/lib/utils";

const TOKEN_CLASS: Partial<Record<TokenKind, string>> = {
  keyword: "text-[var(--code-keyword)] font-medium",
  function: "text-[var(--code-function)]",
  name: "text-[var(--code-name)]",
  string: "text-[var(--code-string)]",
  number: "text-[var(--code-number)]",
  comment: "text-[var(--code-comment)]",
};

/** The code with each token coloured by what it is; white space and punctuation stay plain. */
export function HighlightedCode({ code, lang }: { code: string; lang: CodeLanguage }) {
  const tokens = React.useMemo(() => tokenize(code, lang), [code, lang]);
  return (
    <code className="font-mono">
      {tokens.map((t, i) => {
        const cls = TOKEN_CLASS[t.kind];
        return cls ? (
          <span key={i} className={cls}>
            {t.text}
          </span>
        ) : (
          <React.Fragment key={i}>{t.text}</React.Fragment>
        );
      })}
    </code>
  );
}

const LEGEND: Array<{ label: string; colour: string }> = [
  { label: "Language", colour: "var(--code-keyword)" },
  { label: "Your columns", colour: "var(--code-name)" },
  { label: "Your values", colour: "var(--code-string)" },
  { label: "Notes", colour: "var(--code-comment)" },
];

/** What the colours mean, in one quiet line. */
export function CodeLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle", className)}>
      {LEGEND.map((l) => (
        <li key={l.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full" style={{ background: l.colour }} />
          {l.label}
        </li>
      ))}
    </ul>
  );
}

/** "sql" or "dax" from a label such as "SQL · standard" or "DAX · measure". */
export const languageOf = (label: string): CodeLanguage => (/\bdax\b/i.test(label) ? "dax" : "sql");
