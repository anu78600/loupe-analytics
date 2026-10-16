/**
 * A4 PDFs with real text (selectable, searchable, copyable), for the SQL and
 * insights exports. The dashboard report (report.tsx) is drawn as page
 * images for visual fidelity; queries need to be copied, so these documents
 * are written as text with jsPDF instead.
 *
 * The app's own typeface is embedded (Geist and Geist Mono, SIL Open Font
 * Licence, served from /fonts on this site, so no font host is contacted):
 * jsPDF's built-in fonts can't draw ₹ or the minus sign the formatters use.
 * Colours come from the light theme's tokens (tokens.css), read from the
 * page, so the PDFs match the app.
 *
 * TextPdf lays content top to bottom with automatic page breaks: headings,
 * wrapped paragraphs, label/value lines, highlighted callouts, monospaced
 * code blocks in the app's code colours (the language, the user's columns,
 * their values and notes each in their own colour, as in ui/common/code.tsx)
 * that wrap long lines and continue across pages, simple tables and images. finish() adds the header (wordmark, title, file) and footer
 * (generation note, page x of n) to every page and saves the file.
 */
import type { jsPDF as JsPdf } from "jspdf";
import { tokenize, type CodeLanguage, type TokenKind } from "@/engine/compile/codeTokens";

type Rgb = [number, number, number];
type Tone = "fg" | "muted" | "subtle" | "accent" | "success" | "warning";

/** Light-theme colours from tokens.css, blended over white when translucent. */
interface Palette {
  fg: Rgb;
  muted: Rgb;
  subtle: Rgb;
  accent: Rgb;
  success: Rgb;
  warning: Rgb;
  border: Rgb;
  tint: Rgb;
  accentTint: Rgb;
  /** Code colours by token kind (--code-* tokens). */
  code: Partial<Record<TokenKind, Rgb>>;
}

function parseColour(css: string, fallback: Rgb): Rgb {
  const s = css.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const n = parseInt(hex[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[/,]\s*([\d.]+%?))?\s*\)$/i.exec(s);
  if (rgb) {
    const a = rgb[4] ? (rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4])) : 1;
    // Over white, as on the page.
    return [1, 2, 3].map((i) => Math.round(255 - (255 - Number(rgb[i])) * a)) as Rgb;
  }
  return fallback;
}

/** Reads the light theme's tokens from a probe element; falls back to fixed values off the page. */
function readPalette(): Palette {
  const probe = document.createElement("div");
  probe.dataset.theme = "light";
  probe.style.display = "none";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const v = (name: string, fallback: Rgb) => parseColour(cs.getPropertyValue(name), fallback);
  const palette: Palette = {
    fg: v("--fg", [18, 20, 23]),
    muted: v("--fg-muted", [87, 93, 102]),
    subtle: v("--fg-subtle", [97, 103, 111]),
    accent: v("--accent", [129, 98, 38]),
    success: v("--success", [22, 119, 77]),
    warning: v("--warning", [169, 78, 8]),
    border: v("--border-strong", [222, 222, 223]),
    tint: v("--bg-subtle", [241, 239, 234]),
    accentTint: v("--accent-soft", [246, 243, 238]),
    code: {
      keyword: v("--code-keyword", [44, 86, 201]),
      function: v("--code-function", [117, 53, 176]),
      name: v("--code-name", [131, 86, 0]),
      string: v("--code-string", [26, 114, 57]),
      number: v("--code-number", [168, 77, 5]),
      comment: v("--code-comment", [99, 106, 115]),
    },
  };
  probe.remove();
  return palette;
}

/** Font files are fetched from this site once per page load and kept as base64 for jsPDF. */
const FONT_FILES = {
  regular: "/fonts/Geist-Regular.ttf",
  semibold: "/fonts/Geist-SemiBold.ttf",
  mono: "/fonts/GeistMono-Regular.ttf",
} as const;
let fontCache: Promise<Record<keyof typeof FONT_FILES, string>> | null = null;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  // Chunked: String.fromCharCode on a whole font would overflow the argument stack.
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function loadFonts(): Promise<Record<keyof typeof FONT_FILES, string>> {
  fontCache ??= Promise.all(
    Object.entries(FONT_FILES).map(async ([k, url]) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Couldn't load the PDF font ${url}.`);
      return [k, toBase64(await res.arrayBuffer())] as const;
    }),
  )
    .then((pairs) => Object.fromEntries(pairs) as Record<keyof typeof FONT_FILES, string>)
    .catch((e) => {
      fontCache = null;
      throw e;
    });
  return fontCache;
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 18;
const TOP = 24;
const BOTTOM = PAGE_H - 18;
const WIDTH = PAGE_W - MARGIN_X * 2;
/** pt → mm, and the line height as a multiple of the font size. */
const PT = 0.3528;
const LEADING = 1.4;

export interface TextPdfMeta {
  /** Document title in the header and file properties, e.g. "SQL queries". */
  title: string;
  /** Second header line: industry and data shape. */
  subtitle: string;
  fileName: string;
  isDemo: boolean;
}

export class TextPdf {
  private y = TOP;

  private constructor(
    private readonly pdf: JsPdf,
    private readonly colours: Palette,
    private readonly meta: TextPdfMeta,
  ) {}

  /** A new document with the fonts embedded and the light-theme palette. */
  static async create(meta: TextPdfMeta): Promise<TextPdf> {
    const [{ jsPDF }, fonts] = await Promise.all([import("jspdf"), loadFonts()]);
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    pdf.addFileToVFS("Geist-Regular.ttf", fonts.regular);
    pdf.addFont("Geist-Regular.ttf", "Geist", "normal");
    pdf.addFileToVFS("Geist-SemiBold.ttf", fonts.semibold);
    pdf.addFont("Geist-SemiBold.ttf", "Geist", "bold");
    pdf.addFileToVFS("GeistMono-Regular.ttf", fonts.mono);
    pdf.addFont("GeistMono-Regular.ttf", "GeistMono", "normal");
    pdf.setProperties({
      title: `${meta.title} · ${meta.fileName}`,
      subject: meta.subtitle,
      creator: "Loupe",
    });
    return new TextPdf(pdf, readPalette(), meta);
  }

  private colour(tone: Tone): Rgb {
    return this.colours[tone];
  }

  private font(kind: "regular" | "bold" | "mono", size: number, tone: Tone = "fg"): void {
    if (kind === "mono") this.pdf.setFont("GeistMono", "normal");
    else this.pdf.setFont("Geist", kind === "bold" ? "bold" : "normal");
    this.pdf.setFontSize(size);
    this.pdf.setTextColor(...this.colour(tone));
  }

  /** Starts a new page when `height` mm doesn't fit below the current position. */
  private ensure(height: number): void {
    if (this.y + height <= BOTTOM) return;
    this.pdf.addPage();
    this.y = TOP;
  }

  space(mm: number): void {
    this.y += mm;
  }

  /** A section heading; level 1 is the document title. */
  heading(text: string, level: 1 | 2 | 3 = 2): void {
    const size = level === 1 ? 20 : level === 2 ? 14 : 11;
    const lh = size * PT * 1.25;
    const lines = this.wrap(text, size, "bold", WIDTH);
    this.ensure(lines.length * lh + (level === 3 ? 2 : 5));
    this.y += level === 1 ? 0 : level === 2 ? 4 : 2;
    this.font("bold", size, level === 2 ? "accent" : "fg");
    for (const line of lines) {
      this.y += lh;
      this.pdf.text(line, MARGIN_X, this.y - lh * 0.25);
    }
    this.y += level === 1 ? 3 : 1.5;
  }

  private wrap(text: string, size: number, kind: "regular" | "bold" | "mono", width: number): string[] {
    this.font(kind, size);
    return this.pdf.splitTextToSize(text, width) as string[];
  }

  /** A wrapped paragraph. */
  paragraph(text: string, opts: { size?: number; tone?: Tone; bold?: boolean; after?: number } = {}): void {
    const size = opts.size ?? 9.5;
    const lh = size * PT * LEADING;
    const kind = opts.bold ? "bold" : "regular";
    for (const line of this.wrap(text, size, kind, WIDTH)) {
      this.ensure(lh);
      this.font(kind, size, opts.tone ?? "fg");
      this.y += lh;
      this.pdf.text(line, MARGIN_X, this.y - lh * 0.28);
    }
    this.y += opts.after ?? 2;
  }

  /** "Label: value" lines in two columns of text, for document facts. */
  facts(pairs: Array<[string, string]>): void {
    const size = 9;
    const lh = size * PT * LEADING;
    const labelW = 34;
    for (const [label, value] of pairs) {
      const lines = this.wrap(value, size, "regular", WIDTH - labelW);
      this.ensure(lines.length * lh);
      this.font("regular", size, "muted");
      this.pdf.text(label, MARGIN_X, this.y + lh - lh * 0.28);
      this.font("regular", size, "fg");
      for (const line of lines) {
        this.y += lh;
        this.pdf.text(line, MARGIN_X + labelW, this.y - lh * 0.28);
      }
    }
    this.y += 2;
  }

  /** A highlighted one-paragraph box (an answer's headline). */
  callout(text: string): void {
    const size = 9.5;
    const lh = size * PT * LEADING;
    const pad = 3;
    const lines = this.wrap(text, size, "regular", WIDTH - pad * 2);
    const h = lines.length * lh + pad * 2;
    this.ensure(h + 2);
    this.pdf.setFillColor(...this.colours.accentTint);
    this.pdf.setDrawColor(...this.colours.accent);
    this.pdf.setLineWidth(0.2);
    this.pdf.roundedRect(MARGIN_X, this.y, WIDTH, h, 1.5, 1.5, "FD");
    this.font("regular", size, "fg");
    let ty = this.y + pad;
    for (const line of lines) {
      ty += lh;
      this.pdf.text(line, MARGIN_X + pad, ty - lh * 0.28);
    }
    this.y += h + 3;
  }

  /**
   * A monospaced code block on a tinted background, coloured like the app's
   * code views. Long lines wrap at the block's width with their indentation
   * kept; the block continues on the next page when it doesn't fit.
   */
  code(text: string, label?: string, lang: CodeLanguage = "sql"): void {
    const size = 7.6;
    const lh = size * PT * 1.35;
    const pad = 2.5;
    this.font("mono", size);
    const charW = this.pdf.getTextWidth("M");
    const maxChars = Math.max(20, Math.floor((WIDTH - pad * 2) / charW));
    // The code's tokens, split at line breaks into coloured runs per line.
    type Run = { text: string; kind: TokenKind };
    const source: Run[][] = [[]];
    for (const t of tokenize(text.replace(/\t/g, "  "), lang)) {
      t.text.split("\n").forEach((part, j) => {
        if (j) source.push([]);
        if (part) (source[source.length - 1] as Run[]).push({ text: part, kind: t.kind });
      });
    }
    const lines: Run[][] = [];
    for (const runs of source) {
      const raw = runs.map((r) => r.text).join("");
      if (raw.length <= maxChars) {
        lines.push(runs);
        continue;
      }
      // Continuation lines start two spaces in from the line's own indentation.
      const indent = (/^\s*/.exec(raw)?.[0] ?? "").slice(0, 12);
      let line: Run[] = [];
      let used = 0;
      let room = maxChars;
      for (const r of runs) {
        let rest = r.text;
        while (rest.length) {
          if (used >= room) {
            lines.push(line);
            line = [{ text: `${indent}  `, kind: "space" }];
            used = 0;
            room = maxChars - indent.length - 2;
          }
          const take = Math.min(rest.length, room - used);
          line.push({ text: rest.slice(0, take), kind: r.kind });
          used += take;
          rest = rest.slice(take);
        }
      }
      if (line.length) lines.push(line);
    }
    if (label) this.paragraph(label, { size: 8, tone: "subtle", after: 0.8 });
    let i = 0;
    while (i < lines.length) {
      this.ensure(lh * Math.min(3, lines.length - i) + pad * 2);
      const fit = Math.max(1, Math.floor((BOTTOM - this.y - pad * 2) / lh));
      const chunk = lines.slice(i, i + fit);
      const h = chunk.length * lh + pad * 2;
      this.pdf.setFillColor(...this.colours.tint);
      this.pdf.setDrawColor(...this.colours.border);
      this.pdf.setLineWidth(0.15);
      this.pdf.roundedRect(MARGIN_X, this.y, WIDTH, h, 1.2, 1.2, "FD");
      this.font("mono", size, "fg");
      let ty = this.y + pad;
      for (const line of chunk) {
        ty += lh;
        let x = MARGIN_X + pad;
        for (const run of line) {
          this.pdf.setTextColor(...(this.colours.code[run.kind] ?? this.colours.fg));
          this.pdf.text(run.text, x, ty - lh * 0.28);
          x += this.pdf.getTextWidth(run.text);
        }
      }
      this.y += h;
      i += chunk.length;
      if (i < lines.length) {
        this.pdf.addPage();
        this.y = TOP;
      }
    }
    this.y += 3;
  }

  /** One line naming the code colours, each label after a swatch of its colour. */
  codeLegend(): void {
    const items: Array<[string, TokenKind]> = [
      ["The SQL / DAX language", "keyword"],
      ["Your table and columns", "name"],
      ["Values from your data", "string"],
      ["Notes", "comment"],
    ];
    this.ensure(7);
    const y = this.y + 3;
    let x = MARGIN_X;
    for (const [label, kind] of items) {
      this.pdf.setFillColor(...(this.colours.code[kind] ?? this.colours.fg));
      this.pdf.roundedRect(x, y - 2.2, 2.4, 2.4, 0.5, 0.5, "F");
      x += 3.6;
      this.font("regular", 8, "muted");
      this.pdf.text(label, x, y);
      x += this.pdf.getTextWidth(label) + 6;
    }
    this.y += 7;
  }

  /** A simple table: a header row, then rows; cells are cut to one line. `right` marks right-aligned columns. */
  table(headers: string[], rows: string[][], right: boolean[] = [], shares?: number[]): void {
    const size = 8.5;
    const lh = size * PT * 1.55;
    const n = headers.length;
    // Column widths: the given shares of the text width, else the first column (the group) gets
    // more room than the numbers.
    const firstW = n === 1 ? WIDTH : Math.min(WIDTH * 0.42, Math.max(WIDTH / n, 50));
    const otherW = n === 1 ? 0 : (WIDTH - firstW) / (n - 1);
    const ws = headers.map((_, j) =>
      shares?.[j] !== undefined ? WIDTH * (shares[j] as number) : j === 0 ? firstW : otherW,
    );
    const xs = ws.map((_, j) => MARGIN_X + ws.slice(0, j).reduce((a, b) => a + b, 0));
    const fit = (s: string, w: number, kind: "regular" | "bold") => {
      this.font(kind, size);
      if (this.pdf.getTextWidth(s) <= w - 2) return s;
      let t = s;
      while (t.length > 1 && this.pdf.getTextWidth(`${t}…`) > w - 2) t = t.slice(0, -1);
      return `${t}…`;
    };
    const row = (cells: string[], kind: "regular" | "bold", tone: Tone) => {
      this.ensure(lh);
      this.y += lh;
      cells.forEach((c, j) => {
        const text = fit(c, ws[j] as number, kind);
        this.font(kind, size, tone);
        const x = right[j] ? (xs[j] as number) + (ws[j] as number) - 1 : (xs[j] as number) + 1;
        this.pdf.text(text, x, this.y - lh * 0.3, right[j] ? { align: "right" } : undefined);
      });
      this.pdf.setDrawColor(...this.colours.border);
      this.pdf.setLineWidth(0.15);
      this.pdf.line(MARGIN_X, this.y, MARGIN_X + WIDTH, this.y);
    };
    row(headers, "bold", "muted");
    for (const r of rows) row(r, "regular", "fg");
    this.y += 3;
  }

  /** An image (a PNG data URL) at the full text width, keeping its aspect ratio. */
  image(dataUrl: string, aspect: number): void {
    const h = WIDTH / aspect;
    this.ensure(h + 2);
    this.pdf.addImage(dataUrl, "PNG", MARGIN_X, this.y, WIDTH, h, undefined, "FAST");
    this.y += h + 3;
  }

  /** An image with its caption above it, kept together on one page. */
  figure(caption: string, dataUrl: string, aspect: number): void {
    const size = 8;
    const captionH = size * PT * LEADING + 0.5;
    this.ensure(captionH + WIDTH / aspect + 2);
    this.paragraph(caption, { size, tone: "subtle", after: 0.5 });
    this.image(dataUrl, aspect);
  }

  /** A thin rule between entries. */
  divider(): void {
    this.ensure(4);
    this.y += 1.5;
    this.pdf.setDrawColor(...this.colours.border);
    this.pdf.setLineWidth(0.2);
    this.pdf.line(MARGIN_X, this.y, MARGIN_X + WIDTH, this.y);
    this.y += 2.5;
  }

  /** Adds the header and footer to every page and downloads the file. */
  finish(fileName: string): void {
    const pages = this.pdf.getNumberOfPages();
    const date = new Date().toISOString().slice(0, 10);
    for (let p = 1; p <= pages; p++) {
      this.pdf.setPage(p);
      this.font("bold", 10, "accent");
      this.pdf.text("Loupe", MARGIN_X, 13);
      this.font("regular", 8, "muted");
      this.pdf.text(`${this.meta.title} · ${this.meta.fileName}`, PAGE_W - MARGIN_X, 13, { align: "right" });
      this.pdf.setDrawColor(...this.colours.border);
      this.pdf.setLineWidth(0.2);
      this.pdf.line(MARGIN_X, 16, PAGE_W - MARGIN_X, 16);
      this.font("regular", 7.5, "subtle");
      this.pdf.text(
        `Generated locally by Loupe on ${date}. Data never left the browser.${this.meta.isDemo ? " Demo data: synthetic, not real." : ""}`,
        MARGIN_X,
        PAGE_H - 9,
      );
      this.pdf.text(`Page ${p} of ${pages}`, PAGE_W - MARGIN_X, PAGE_H - 9, { align: "right" });
    }
    this.pdf.save(fileName);
  }
}
