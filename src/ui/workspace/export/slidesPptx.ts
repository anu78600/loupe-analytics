/**
 * Slides as editable PowerPoint shapes (version 57.0). The deck is laid out
 * once (slides.tsx, the same layout the PNG and PDF slides draw), then each
 * slide is read from the page: every block of text becomes a text box at the
 * same place, in the same size, weight and colours (one run per colour, so a
 * KPI's change keeps its green or red), every card and chip a rectangle with
 * its fill, border and corners, and what is marked data-pptx="image" (a
 * chart, a table, a trend line, the wordmark) a picture, with its alt text;
 * the caller cuts the pictures from the slide drawn whole (slides.tsx), as
 * the PNG slides draw it. engine/export/pptx.ts writes the file.
 *
 * Colours are read through a canvas, so any CSS colour the theme uses
 * (oklch, color-mix) arrives as plain RGB; a see-through fill is blended
 * over the slide's background, as it looks. Unmarked icons (an arrow in a
 * chip) are decoration and are left out.
 */
import type { PptxDecoration, PptxRun, PptxShape, PptxSlide } from "@/engine/export/pptx";

type Rgba = [number, number, number, number];

let probe: CanvasRenderingContext2D | null = null;
const colours = new Map<string, Rgba>();

/** Any CSS colour as RGBA (0–255, alpha 0–1), read the way the browser paints it. */
function rgba(css: string): Rgba {
  const hit = colours.get(css);
  if (hit) return hit;
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  let out: Rgba = [0, 0, 0, 0];
  if (probe) {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "#000";
    probe.fillStyle = css;
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    out = [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 0) / 255];
  }
  colours.set(css, out);
  return out;
}

const toHex = ([r, g, b]: Rgba) => [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** A colour over the slide's background, as it shows (a tint stays a tint, not a strong colour). */
function over(c: Rgba, background: Rgba): string {
  const a = c[3];
  return toHex(
    [0, 1, 2].map((i) => (c[i] as number) * a + (background[i] as number) * (1 - a)) as unknown as Rgba,
  );
}

const px = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** The element's fill, border and corners, when it has any to draw. */
function decoration(cs: CSSStyleDeclaration, w: number, h: number, bg: Rgba): PptxDecoration | null {
  const fill = rgba(cs.backgroundColor);
  const width = px(cs.borderTopWidth);
  const sides = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(px);
  const border = rgba(cs.borderTopColor);
  const out: PptxDecoration = {};
  if (fill[3] > 0.02) out.fill = over(fill, bg);
  // Only a border on every side outlines the shape; a rule on one side is drawn separately (rule()).
  if (width > 0 && sides.every((s) => s === width) && border[3] > 0.02)
    out.line = { color: over(border, bg), width };
  const radius = px(cs.borderTopLeftRadius);
  if (radius > 0) {
    if (radius >= Math.min(w, h) / 2 - 0.5 && Math.abs(w - h) < 2) out.ellipse = true;
    else out.radius = radius;
  }
  return out.fill || out.line ? out : null;
}

/** A border on the top only (a footer's rule) as a thin filled box. */
function rule(cs: CSSStyleDeclaration, x: number, y: number, w: number, bg: Rgba): PptxShape | null {
  const top = px(cs.borderTopWidth);
  const others = [cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(px);
  if (top <= 0 || others.some((s) => s > 0)) return null;
  const c = rgba(cs.borderTopColor);
  return c[3] > 0.02 ? { kind: "box", x, y, w, h: top, fill: over(c, bg) } : null;
}

const INLINE = new Set(["inline", "contents"]);

/** Whether an element holds only text and inline elements (so it is one text box). */
function inlineOnly(el: Element): boolean {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) continue;
    if (!(node instanceof HTMLElement)) return false;
    if (node.tagName === "BR") continue;
    if (node.dataset.pptx || !INLINE.has(getComputedStyle(node).display) || !inlineOnly(node)) return false;
  }
  return true;
}

/** The text of an inline-only element as runs, one per text node, with white space collapsed as CSS does. */
function runsOf(el: HTMLElement, upper: boolean, bg: Rgba): PptxRun[] {
  const runs: PptxRun[] = [];
  const visit = (node: Node, transform: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement as HTMLElement;
      const cs = getComputedStyle(parent);
      const text = (node.textContent ?? "").replace(/\s+/g, " ");
      if (!text) return;
      runs.push({
        text: transform ? text.toUpperCase() : text,
        color: over(rgba(cs.color), bg),
        bold: Number(cs.fontWeight) >= 600,
        italic: cs.fontStyle === "italic",
      });
      return;
    }
    if (node instanceof HTMLElement) {
      if (node.tagName === "BR") {
        runs.push({ text: "\n", color: "000000" });
        return;
      }
      const t = transform || getComputedStyle(node).textTransform === "uppercase";
      node.childNodes.forEach((c) => visit(c, t));
    }
  };
  el.childNodes.forEach((c) => visit(c, upper));
  // Leading and trailing spaces go, as the browser drops them at a line's ends.
  while (runs.length && !runs[0]?.text.trim()) runs.shift();
  while (runs.length && !runs[runs.length - 1]?.text.trim()) runs.pop();
  const first = runs[0];
  const last = runs[runs.length - 1];
  if (first) first.text = first.text.replace(/^ +/, "");
  if (last) last.text = last.text.replace(/ +$/, "");
  return runs;
}

/**
 * One slide's shapes, read from its laid-out element. `picture` draws an
 * element as PNG bytes (html-to-image), for what is marked as an image.
 */
export async function readSlide(
  slide: HTMLElement,
  picture: (el: HTMLElement) => Promise<Uint8Array>,
): Promise<PptxSlide> {
  const origin = slide.getBoundingClientRect();
  const bg = rgba(getComputedStyle(slide).backgroundColor);
  const background = bg[3] > 0.02 ? toHex(bg) : "FFFFFF";
  const base: Rgba = bg[3] > 0.02 ? bg : [255, 255, 255, 1];
  const shapes: PptxShape[] = [];

  const walk = async (el: HTMLElement): Promise<void> => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return;
    const r = el.getBoundingClientRect();
    const x = r.left - origin.left;
    const y = r.top - origin.top;
    const w = r.width;
    const h = r.height;
    if (w < 1 || h < 1) return;
    if (el.dataset.pptx === "image") {
      shapes.push({ kind: "image", x, y, w, h, png: await picture(el), alt: el.dataset.pptxAlt ?? "" });
      return;
    }
    // Drawings not marked as pictures are decoration (an icon's SVG is never an HTML element, so never walked).
    if (el.tagName === "CANVAS" || el.tagName === "IMG") return;
    const deco = el === slide ? null : decoration(cs, w, h, base);
    const line = el === slide ? null : rule(cs, x, y, w, base);
    if (line) shapes.push(line);
    const hasText = (el.textContent ?? "").trim().length > 0;
    if (hasText && inlineOnly(el)) {
      const runs = runsOf(el, cs.textTransform === "uppercase", base);
      if (!runs.length) return;
      const size = px(cs.fontSize);
      const lineHeight = cs.lineHeight === "normal" ? undefined : px(cs.lineHeight);
      const centred =
        /flex|grid/.test(cs.display) &&
        (cs.justifyContent === "center" ||
          cs.justifyItems === "center" ||
          cs.placeItems.startsWith("center"));
      const align = centred || cs.textAlign === "center" ? "ctr" : /right|end/.test(cs.textAlign) ? "r" : "l";
      shapes.push({
        kind: "text",
        x,
        y,
        w,
        h,
        runs,
        size,
        ...(lineHeight ? { lineHeight } : {}),
        align,
        ...(cs.letterSpacing !== "normal" && px(cs.letterSpacing) ? { spacing: px(cs.letterSpacing) } : {}),
        // Text on one line in the app stays on one line: PowerPoint's font runs a little wider, and
        // wrapping an eyebrow or a label would push it into what sits below it.
        nowrap:
          cs.whiteSpace === "nowrap" ||
          cs.textOverflow === "ellipsis" ||
          h - px(cs.paddingTop) - px(cs.paddingBottom) < (lineHeight ?? size * 1.2) * 1.5,
        padding: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)],
        anchor: /flex|grid/.test(cs.display) && cs.alignItems === "center" ? "ctr" : "t",
        ...(deco ?? {}),
      });
      return;
    }
    if (deco) shapes.push({ kind: "box", x, y, w, h, ...deco });
    for (const child of el.children) if (child instanceof HTMLElement) await walk(child);
  };
  await walk(slide);
  return { background, shapes };
}

/** The chart palette's first six colours, as the deck's theme accents. */
export function themeAccents(palette: readonly string[]): string[] {
  return palette.slice(0, 6).map((c) => toHex(rgba(c)));
}
