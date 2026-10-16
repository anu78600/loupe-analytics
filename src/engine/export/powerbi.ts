/**
 * Assembles the Power BI package (.zip) from the individual generators.
 *
 * Runs in the worker and zips synchronously with fflate. Everything sits under
 * one folder, named like the zip ("loupe-powerbi" by default): README.md, data.csv (injection-guarded,
 * export-safe headers), measures.dax, kpis.sql, the data dictionary,
 * loupe-config.json and the `<Table>.SemanticModel/` TMDL folder. A real
 * .pbix cannot be produced in a browser; the README explains this.
 */
import { generateCodeHtml } from "./codeHtml";
import { strToU8, zipSync, type Zippable } from "fflate";
import { currencySymbol } from "@/engine/core/format";
import { datasetToCsvChunks, UTF8_BOM } from "./csv";
import type { ExportContext } from "./context";
import { generateDaxFile } from "./daxFile";
import { dictionaryCsv, dictionaryMarkdown } from "./dictionary";
import { generateReadme, newColumnsFor, type NewColumn } from "./readme";
import { generateSqlFile } from "./sqlFile";
import { generateTmdl } from "./tmdl";

/**
 * What the package contains, for the UI. `files[].bytes` are uncompressed
 * sizes with paths relative to the package folder; `totalBytes` is the size
 * of the compressed zip, so the two do not add up. `newColumns` are the
 * columns this package adds to the data table in Power BI (its model builds
 * them, its README shows how to add them by hand): the UI asks before handing
 * over a package that has any, so the question names exactly these.
 */
export interface PackageManifest {
  files: Array<{ path: string; bytes: number }>;
  totalBytes: number;
  newColumns: NewColumn[];
}

/** Builds the zip. `ctx.specs` should already be the visible dashboard charts, in order. */
export function buildPowerBiPackage(
  ctx: ExportContext,
  configJson: string,
  folderName?: string,
): { zip: Uint8Array; manifest: PackageManifest } {
  const symbol = currencySymbol(ctx.currency).trim();
  // Only a plain name can be a folder: anything else falls back to the default.
  const folder = folderName && /^[\w.-]+$/.test(folderName) ? folderName : "loupe-powerbi";
  const headers = ctx.names.columns;
  const csvParts = datasetToCsvChunks(ctx.ds, { headers, guardInjection: true });
  // Concatenate chunk bytes without building one giant JS string.
  const encoded = csvParts.map((p) => strToU8(p));
  const csvBytes = new Uint8Array(encoded.reduce((s, b) => s + b.length, 0));
  let off = 0;
  for (const b of encoded) {
    csvBytes.set(b, off);
    off += b.length;
  }
  const visualSpecs = ctx.specs;
  const files: Record<string, Uint8Array> = {
    [`${folder}/README.md`]: strToU8(generateReadme(ctx, visualSpecs, symbol)),
    [`${folder}/data.csv`]: csvBytes,
    [`${folder}/measures.dax`]: strToU8(generateDaxFile(ctx, symbol)),
    // SQL adds nothing to the Power BI model, so it keeps the date column (and its monthly views)
    // even when the Date table was left out for want of a new column.
    [`${folder}/kpis.sql`]: strToU8(
      generateSqlFile(ctx.dateTableSkipped ? { ...ctx, dateColumn: ctx.dateTableSkipped } : ctx),
    ),
    // The same SQL and DAX in colour, to read in a browser (the .sql and .dax are plain text).
    [`${folder}/kpis-sql-and-dax.html`]: strToU8(generateCodeHtml(ctx, symbol)),
    // The dictionary is read in a spreadsheet, so it carries the byte-order mark Excel needs for UTF-8.
    [`${folder}/data-dictionary.csv`]: strToU8(UTF8_BOM + dictionaryCsv(ctx)),
    [`${folder}/data-dictionary.md`]: strToU8(dictionaryMarkdown(ctx)),
    [`${folder}/loupe-config.json`]: strToU8(configJson),
  };
  if (ctx.reportTheme) files[`${folder}/loupe-theme.json`] = strToU8(ctx.reportTheme.json);
  const tmdl = generateTmdl(ctx, symbol, ctx.names.table);
  for (const [path, text] of Object.entries(tmdl)) files[`${folder}/${path}`] = strToU8(text);
  const zippable: Zippable = {};
  // CSVs can be large, so they use a faster compression level; the small text files get maximum compression.
  for (const [path, bytes] of Object.entries(files))
    zippable[path] = [bytes, { level: path.endsWith(".csv") ? 6 : 9 }];
  const zip = zipSync(zippable);
  const manifest: PackageManifest = {
    files: Object.entries(files).map(([path, bytes]) => ({
      path: path.slice(folder.length + 1),
      bytes: bytes.length,
    })),
    totalBytes: zip.length,
    newColumns: ctx.noNewColumns ? [] : newColumnsFor(ctx, ctx.specs),
  };
  return { zip, manifest };
}
