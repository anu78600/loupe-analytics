/**
 * A small PowerPoint (.pptx) writer (version 57.0): 16:9 slides of text
 * boxes, rectangles and pictures, zipped as Office Open XML that PowerPoint,
 * Keynote, Google Slides and LibreOffice open. Every word on a slide is a
 * text box, so titles, takeaways and figures can be edited before a meeting;
 * charts and tables are pictures (with their alt text), drawn exactly as on
 * the dashboard.
 *
 * Positions and sizes are given in the slide's laid-out pixels (1920 × 1080
 * in slides.tsx) and written in EMU (1 px = 6350 EMU on a 13.33 × 7.5 inch
 * slide); text sizes in pixels become points (1 px = 0.5 pt). The theme's
 * accent colours are the chart palette, so a shape added in PowerPoint
 * matches the deck. Written here rather than with a library, which would
 * bring dependencies of its own into an app that promises nothing leaves the
 * browser; the parts are the minimum PowerPoint requires.
 */
import { zipSync, strToU8 } from "fflate";

interface Frame {
  /** Laid-out pixels from the slide's top left. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A filled or outlined shape: a card, a chip, a numbered circle. */
export interface PptxDecoration {
  /** Six-digit hex, no "#". */
  fill?: string;
  line?: { color: string; width: number };
  /** Corner radius in pixels; an ellipse when `ellipse`. */
  radius?: number;
  ellipse?: boolean;
}

/** A stretch of text in one colour and weight; a line break in it starts a new paragraph. */
export interface PptxRun {
  text: string;
  /** Six-digit hex, no "#". */
  color: string;
  bold?: boolean;
  italic?: boolean;
}

export type PptxShape =
  | ({ kind: "box" } & Frame & PptxDecoration)
  | ({
      kind: "text";
      runs: PptxRun[];
      /** Font size and line height in pixels. */
      size: number;
      lineHeight?: number;
      align?: "l" | "ctr" | "r";
      /** Letter spacing in pixels. */
      spacing?: number;
      /** One line, as written (no wrapping). */
      nowrap?: boolean;
      /** Inner padding in pixels: top, right, bottom, left. */
      padding?: [number, number, number, number];
      anchor?: "t" | "ctr";
    } & Frame &
      PptxDecoration)
  | ({ kind: "image"; png: Uint8Array; alt: string } & Frame);

export interface PptxSlide {
  /** The slide's background, six-digit hex. */
  background: string;
  shapes: PptxShape[];
}

export interface PptxOptions {
  title: string;
  /** The laid-out slide size in pixels (16:9). */
  width: number;
  height: number;
  /** Six theme accents, six-digit hex (the chart palette). */
  accents?: string[];
  /** The font every text box uses: one PowerPoint has everywhere. */
  font?: string;
}

const SLIDE_CX = 12_192_000;
const SLIDE_CY = 6_858_000;
const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// Characters XML 1.0 can't hold (control characters, lone surrogates) are dropped.
const BAD_XML =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const esc = (s: string) =>
  s
    .replace(BAD_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const hex = (c: string) => (/^[0-9a-fA-F]{6}$/.test(c) ? c.toUpperCase() : "000000");

const GROUP =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function theme(accents: string[], font: string): string {
  const a = (i: number) =>
    hex(accents[i] ?? ["4F46E5", "0EA5E9", "F59E0B", "10B981", "EF4444", "8B5CF6"][i] ?? "4F46E5");
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const fontSet = `<a:latin typeface="${esc(font)}"/><a:ea typeface=""/><a:cs typeface=""/>`;
  return (
    `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Loupe"><a:themeElements>` +
    `<a:clrScheme name="Loupe"><a:dk1><a:srgbClr val="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>` +
    `<a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>` +
    [0, 1, 2, 3, 4, 5]
      .map((i) => `<a:accent${i + 1}><a:srgbClr val="${a(i)}"/></a:accent${i + 1}>`)
      .join("") +
    `<a:hlink><a:srgbClr val="${a(0)}"/></a:hlink><a:folHlink><a:srgbClr val="${a(5)}"/></a:folHlink></a:clrScheme>` +
    `<a:fontScheme name="Loupe"><a:majorFont>${fontSet}</a:majorFont><a:minorFont>${fontSet}</a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="Loupe"><a:fillStyleLst>${solid}${solid}${solid}</a:fillStyleLst>` +
    `<a:lnStyleLst>${[6350, 12700, 19050].map((w) => `<a:ln w="${w}">${solid}</a:ln>`).join("")}</a:lnStyleLst>` +
    `<a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst>` +
    `<a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst></a:fmtScheme>` +
    `</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
  );
}

function master(font: string): string {
  const level = (sz: number) =>
    `<a:lvl1pPr><a:defRPr sz="${sz}"><a:latin typeface="${esc(font)}"/></a:defRPr></a:lvl1pPr>`;
  return (
    `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}</p:spTree></p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
    `<p:txStyles><p:titleStyle>${level(4400)}</p:titleStyle><p:bodyStyle>${level(1800)}</p:bodyStyle><p:otherStyle>${level(1800)}</p:otherStyle></p:txStyles>` +
    `</p:sldMaster>`
  );
}

const LAYOUT =
  `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld>` +
  `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const rels = (items: Array<[string, string, string]>) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
    .join("")}</Relationships>`;

/** The slide parts for one slide, with the pictures it embeds. */
function slideXml(
  slide: PptxSlide,
  emu: number,
  font: string,
  firstImage: number,
): { xml: string; images: Uint8Array[] } {
  const E = (px: number) => Math.round(px * emu);
  // Font sizes in hundredths of a point: px × EMU-per-px ÷ 12,700 EMU-per-pt × 100.
  const pt100 = (px: number) => Math.max(100, Math.round((px * emu * 100) / 12_700));
  const images: Uint8Array[] = [];
  let id = 2;
  const xfrm = (s: Frame) =>
    `<a:xfrm><a:off x="${E(s.x)}" y="${E(s.y)}"/><a:ext cx="${Math.max(1, E(s.w))}" cy="${Math.max(1, E(s.h))}"/></a:xfrm>`;
  const geometry = (s: Frame & PptxDecoration) => {
    if (s.ellipse) return '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>';
    if (s.radius && s.radius > 0) {
      const adj = Math.min(50_000, Math.round((s.radius / Math.max(1, Math.min(s.w, s.h))) * 100_000));
      return `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`;
    }
    return '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  };
  const paint = (s: PptxDecoration) =>
    (s.fill ? `<a:solidFill><a:srgbClr val="${hex(s.fill)}"/></a:solidFill>` : "<a:noFill/>") +
    (s.line
      ? `<a:ln w="${E(s.line.width)}"><a:solidFill><a:srgbClr val="${hex(s.line.color)}"/></a:solidFill></a:ln>`
      : "<a:ln><a:noFill/></a:ln>");
  const body = slide.shapes.map((s) => {
    const n = id++;
    if (s.kind === "image") {
      images.push(s.png);
      return (
        `<p:pic><p:nvPicPr><p:cNvPr id="${n}" name="Chart ${n}" descr="${esc(s.alt)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
        `<p:blipFill><a:blip r:embed="rId${firstImage + images.length}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
        `<p:spPr>${xfrm(s)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
      );
    }
    if (s.kind === "box")
      return (
        `<p:sp><p:nvSpPr><p:cNvPr id="${n}" name="Shape ${n}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
        `<p:spPr>${xfrm(s)}${geometry(s)}${paint(s)}</p:spPr></p:sp>`
      );
    const [pt, pr, pb, pl] = s.padding ?? [0, 0, 0, 0];
    const decorated = Boolean(s.fill || s.line);
    const run = (r: PptxRun, text: string) =>
      `<a:r><a:rPr lang="en-GB" sz="${pt100(s.size)}"${r.bold ? ' b="1"' : ""}${r.italic ? ' i="1"' : ""}${s.spacing ? ` spc="${Math.round((s.spacing * emu * 100) / 12_700)}"` : ""} dirty="0">` +
      `<a:solidFill><a:srgbClr val="${hex(r.color)}"/></a:solidFill><a:latin typeface="${esc(font)}"/><a:cs typeface="${esc(font)}"/></a:rPr><a:t>${esc(text)}</a:t></a:r>`;
    const spacing = s.lineHeight ? `<a:lnSpc><a:spcPts val="${pt100(s.lineHeight)}"/></a:lnSpc>` : "";
    // The runs, split into paragraphs at each line break.
    const lines: string[][] = [[]];
    for (const r of s.runs)
      r.text.split("\n").forEach((part, k) => {
        if (k > 0) lines.push([]);
        if (part) lines[lines.length - 1]?.push(run(r, part));
      });
    const paragraphs = lines
      .map(
        (runs) =>
          `<a:p><a:pPr algn="${s.align ?? "l"}">${spacing}</a:pPr>${runs.join("")}<a:endParaRPr lang="en-GB" sz="${pt100(s.size)}" dirty="0"/></a:p>`,
      )
      .join("");
    return (
      `<p:sp><p:nvSpPr><p:cNvPr id="${n}" name="Text ${n}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr>${xfrm(s)}${geometry(s)}${paint(s)}</p:spPr>` +
      `<p:txBody><a:bodyPr wrap="${s.nowrap ? "none" : "square"}" lIns="${E(pl)}" tIns="${E(pt)}" rIns="${E(pr)}" bIns="${E(pb)}" rtlCol="0" anchor="${s.anchor ?? "t"}">` +
      // A plain text box grows with what is typed in it; a chip or a circle keeps its size.
      `${decorated ? "<a:noAutofit/>" : "<a:spAutoFit/>"}</a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`
    );
  });
  return {
    xml:
      `${XML}<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex(slide.background)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` +
      `<p:spTree>${GROUP}${body.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    images,
  };
}

/** The deck as .pptx bytes. */
export function pptxDeck(slides: readonly PptxSlide[], opts: PptxOptions): Uint8Array {
  const emu = SLIDE_CX / opts.width;
  const font = opts.font ?? "Arial";
  const files: Record<string, Uint8Array> = {};
  const put = (path: string, text: string) => {
    files[path] = strToU8(text);
  };
  let imageNo = 0;
  const slideOverrides: string[] = [];
  slides.forEach((slide, i) => {
    const n = i + 1;
    const { xml, images } = slideXml(slide, emu, font, 1);
    put(`ppt/slides/slide${n}.xml`, xml);
    const imageRels: Array<[string, string, string]> = images.map((png, k) => {
      imageNo++;
      files[`ppt/media/image${imageNo}.png`] = png;
      return [`rId${k + 2}`, `${REL}/image`, `../media/image${imageNo}.png`];
    });
    put(
      `ppt/slides/_rels/slide${n}.xml.rels`,
      rels([["rId1", `${REL}/slideLayout`, "../slideLayouts/slideLayout1.xml"], ...imageRels]),
    );
    slideOverrides.push(
      `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    );
  });
  put(
    "ppt/presentation.xml",
    `${XML}<p:presentation ${NS} saveSubsetFonts="1">` +
      `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
      `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join("")}</p:sldIdLst>` +
      `<p:sldSz cx="${SLIDE_CX}" cy="${SLIDE_CY}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  put(
    "ppt/_rels/presentation.xml.rels",
    rels([
      ["rId1", `${REL}/slideMaster`, "slideMasters/slideMaster1.xml"],
      ["rId2", `${REL}/theme`, "theme/theme1.xml"],
      ...slides.map((_, i): [string, string, string] => [
        `rId${i + 3}`,
        `${REL}/slide`,
        `slides/slide${i + 1}.xml`,
      ]),
    ]),
  );
  put("ppt/slideMasters/slideMaster1.xml", master(font));
  put(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    rels([
      ["rId1", `${REL}/slideLayout`, "../slideLayouts/slideLayout1.xml"],
      ["rId2", `${REL}/theme`, "../theme/theme1.xml"],
    ]),
  );
  put("ppt/slideLayouts/slideLayout1.xml", LAYOUT);
  put(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    rels([["rId1", `${REL}/slideMaster`, "../slideMasters/slideMaster1.xml"]]),
  );
  put("ppt/theme/theme1.xml", theme(opts.accents ?? [], font));
  put(
    "docProps/core.xml",
    `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${esc(opts.title)}</dc:title><dc:creator>Loupe</dc:creator></cp:coreProperties>`,
  );
  put(
    "_rels/.rels",
    rels([
      ["rId1", `${REL}/officeDocument`, "ppt/presentation.xml"],
      [
        "rId2",
        "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
        "docProps/core.xml",
      ],
    ]),
  );
  put(
    "[Content_Types].xml",
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
      `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
      `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
      `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>` +
      `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      slideOverrides.join("") +
      `</Types>`,
  );
  // Pictures are PNGs, already compressed: stored, they zip as small and much faster.
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([p, b]) => [p, p.endsWith(".png") ? [b, { level: 0 }] : [b, { level: 6 }]]),
    ),
  );
}
