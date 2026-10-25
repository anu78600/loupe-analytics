/**
 * The PowerPoint writer (version 57.0): a deck holds every part PowerPoint
 * needs, one slide part per slide with its pictures, text as editable runs
 * (escaped, in their colours, one paragraph per line) and shapes placed in
 * EMU from the slide's pixels. Every XML part is well formed. The file was
 * also opened in PowerPoint itself while building it; this guards the parts.
 */
import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { pptxDeck, type PptxSlide } from "@/engine/export/pptx";

/** Tags open and close in order (a light well-formedness check; attribute values are escaped). */
function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)[^>]*?(\/?)>/g)) {
    const [, close, name, self] = m;
    if (self) continue;
    if (close) {
      if (stack.pop() !== name) return false;
    } else stack.push(name as string);
  }
  return stack.length === 0;
}

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const slides: PptxSlide[] = [
  {
    background: "F7F7F8",
    shapes: [
      {
        kind: "box",
        x: 80,
        y: 200,
        w: 800,
        h: 400,
        fill: "FFFFFF",
        line: { color: "E5E7EB", width: 1 },
        radius: 16,
      },
      {
        kind: "text",
        x: 960,
        y: 100,
        w: 600,
        h: 60,
        size: 50,
        runs: [
          { text: 'R&D <5> "growth"', color: "111827", bold: true },
          { text: "\nsecond line", color: "16A34A" },
        ],
      },
      {
        kind: "text",
        x: 100,
        y: 700,
        w: 40,
        h: 40,
        size: 18,
        runs: [{ text: "1", color: "4338CA" }],
        fill: "EEF2FF",
        ellipse: true,
        anchor: "ctr",
        align: "ctr",
      },
      { kind: "image", x: 100, y: 220, w: 760, h: 360, png, alt: "Line chart of revenue by month" },
    ],
  },
  {
    background: "FFFFFF",
    shapes: [
      { kind: "text", x: 80, y: 60, w: 400, h: 30, size: 18, runs: [{ text: "Trend", color: "4338CA" }] },
    ],
  },
];

describe("a PowerPoint deck", () => {
  const files = unzipSync(pptxDeck(slides, { title: "Sales · slides", width: 1920, height: 1080 }));
  const text = (p: string) => strFromU8(files[p] as Uint8Array);

  it("holds the parts PowerPoint needs, all well formed", () => {
    for (const p of [
      "[Content_Types].xml",
      "_rels/.rels",
      "ppt/presentation.xml",
      "ppt/_rels/presentation.xml.rels",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideLayouts/slideLayout1.xml",
      "ppt/theme/theme1.xml",
      "ppt/slides/slide1.xml",
      "ppt/slides/slide2.xml",
      "docProps/core.xml",
    ])
      expect(files[p], p).toBeDefined();
    for (const [p, bytes] of Object.entries(files))
      if (/\.(xml|rels)$/.test(p)) expect(wellFormed(strFromU8(bytes)), p).toBe(true);
    expect(text("ppt/presentation.xml").match(/<p:sldId /g)).toHaveLength(2);
    expect(text("[Content_Types].xml")).toContain('PartName="/ppt/slides/slide2.xml"');
  });

  it("writes text as editable runs, escaped and in their colours, a paragraph a line", () => {
    const xml = text("ppt/slides/slide1.xml");
    expect(xml).toContain("<a:t>R&amp;D &lt;5&gt; &quot;growth&quot;</a:t>");
    expect(xml).toContain('b="1"');
    expect(xml).toContain('<a:srgbClr val="16A34A"/>');
    expect(xml.match(/<a:p>/g)?.length).toBeGreaterThanOrEqual(3);
    // 50 px on a 1920 px slide is 25 pt; 960 px is half the 12,192,000 EMU width.
    expect(xml).toContain('sz="2500"');
    expect(xml).toContain('<a:off x="6096000" y="635000"/>');
    expect(xml).toContain('prst="ellipse"');
    expect(xml).toContain('prst="roundRect"');
  });

  it("embeds each picture once, with its alt text", () => {
    expect(files["ppt/media/image1.png"]).toEqual(png);
    expect(text("ppt/slides/_rels/slide1.xml.rels")).toContain('Target="../media/image1.png"');
    expect(text("ppt/slides/slide1.xml")).toContain('descr="Line chart of revenue by month"');
  });
});
