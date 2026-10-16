"use client";

/**
 * A chart as an image to keep or send, framed the way a slide frames it:
 * the title, the takeaway (with the accent rule the card gives it) and the
 * unit line above the plot, and the slice it shows (file, rows, period,
 * filters) under it, so the picture still says what it is once it leaves the
 * app. Drawn on a canvas at the plot image's own pixel ratio, in the chart
 * tokens' colours and font, so it matches the theme it was taken in; a
 * transparent export keeps the text and drops only the background.
 */
import type { ChartTokens } from "./tokens";

export interface FramedChart {
  /** The plot (or the table view) as a PNG data URL, `scale` times its laid-out size. */
  image: string;
  /** Image pixels per laid-out pixel (2 for the 2× export). */
  scale: number;
  title: string;
  /** The chart's takeaway (chartHeadline), when it has one. */
  headline?: string;
  /** The unit line ("In ₹ · monthly"). */
  subtitle?: string;
  /** What the numbers cover: "Source: orders.csv · 18,396 rows · Last 12 months · No filters". */
  footer?: string;
  tokens: ChartTokens;
  /** Background colour; omitted for a transparent image. */
  background?: string;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The chart image could not be read."));
    img.src = src;
  });
}

/** `text` in lines that fit `width` px in the context's current font, broken at spaces. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

interface Block {
  text: string;
  /** Font size in image pixels. */
  size: number;
  weight?: number;
  color: string;
  lineHeight: number;
  /** Space above the block. */
  gap: number;
  /** Left inset of the text (the takeaway sits beside its accent rule). */
  inset?: number;
  rule?: string;
}

/** The framed chart as a PNG data URL (see the file header). */
export async function framedChartPng(f: FramedChart): Promise<string> {
  const img = await loadImage(f.image);
  // Text is measured and drawn in the page's own font, so wait for it rather than measure a fallback.
  await document.fonts?.ready;
  const s = f.scale;
  const t = f.tokens;
  const pad = 20 * s;
  const width = img.width + 2 * pad;
  const textWidth = width - 2 * pad;
  const fontOf = (b: Block) => `${b.weight ?? 400} ${b.size}px ${t.fontSans}`;
  const above: Block[] = [
    { text: f.title, size: 15 * s, weight: 500, color: t.fg, lineHeight: 20 * s, gap: 0 },
    ...(f.headline
      ? [
          {
            text: f.headline,
            size: 13 * s,
            color: t.fg,
            lineHeight: 18 * s,
            gap: 6 * s,
            inset: 10 * s,
            rule: t.accent,
          },
        ]
      : []),
    ...(f.subtitle
      ? [{ text: f.subtitle, size: 11 * s, color: t.subtle, lineHeight: 15 * s, gap: 4 * s }]
      : []),
  ];
  const below: Block[] = f.footer
    ? [{ text: f.footer, size: 11 * s, color: t.subtle, lineHeight: 15 * s, gap: 10 * s }]
    : [];

  // Measure first (sizing a canvas resets its drawing state), then draw.
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return f.image;
  const lay = (b: Block) => {
    measure.font = fontOf(b);
    return wrap(measure, b.text, textWidth - (b.inset ?? 0));
  };
  const laidAbove = above.map((b) => ({ b, lines: lay(b) }));
  const laidBelow = below.map((b) => ({ b, lines: lay(b) }));
  const blockHeight = (x: { b: Block; lines: string[] }) => x.b.gap + x.lines.length * x.b.lineHeight;
  const head = laidAbove.reduce((h, x) => h + blockHeight(x), 0);
  const foot = laidBelow.reduce((h, x) => h + blockHeight(x), 0);
  const height = pad + head + 12 * s + img.height + foot + pad;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return f.image;
  if (f.background) {
    ctx.fillStyle = f.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.textBaseline = "top";
  let y = pad;
  const draw = (x: { b: Block; lines: string[] }) => {
    y += x.b.gap;
    if (x.b.rule) {
      ctx.fillStyle = x.b.rule;
      ctx.fillRect(pad, y, 2 * s, x.lines.length * x.b.lineHeight);
    }
    ctx.font = fontOf(x.b);
    ctx.fillStyle = x.b.color;
    for (const line of x.lines) {
      // Centred in its line box: half the leading above the glyphs.
      ctx.fillText(line, pad + (x.b.inset ?? 0), y + (x.b.lineHeight - x.b.size) / 2);
      y += x.b.lineHeight;
    }
  };
  laidAbove.forEach(draw);
  y += 12 * s;
  ctx.drawImage(img, pad, y);
  y += img.height;
  laidBelow.forEach(draw);
  return canvas.toDataURL("image/png");
}
