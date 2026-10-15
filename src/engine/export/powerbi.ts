/**
 * Assembles the Power BI package (.zip) from the individual generators.
 *
 * Runs in the worker and zips synchronously with fflate. Everything sits under
 * one "loupe-powerbi/" folder: README.md, data.csv (injection-guarded,
 * export-safe headers), measures.dax, kpis.sql, the data dictionary,
 * loupe-config.json and the `<Table>.SemanticModel/` TMDL folder. A real
 * .pbix cannot be produced in a browser; the README explains this.
 */
import { strToU8, zipSync, type Zippable } from "fflate";
import { currencySymbol } from "@/engine/core/format";
import { datasetToCsvChunks } from "./csv";
import type { ExportContext } from "./context";
import { generateDaxFile } from "./daxFile";
import { dictionaryCsv, dictionaryMarkdown } from "./dictionary";
import { generateReadme } from "./readme";
import { generateSqlFile } from "./sqlFile";
import { generateTmdl } from "./tmdl";

/**
 * What the package contains, for the UI. `files[].bytes` are uncompressed
 * sizes with paths relative to the package folder; `totalBytes` is the size
 * of the compressed zip, so the two do not add up.
 */
export interface PackageManifest {
  files: Array<{ path: string; bytes: number }>;
  totalBytes: number;
}

/** Builds the zip. `ctx.specs` should already be the visible dashboard charts, in order. */
export function buildPowerBiPackage(
  ctx: ExportContext,
  configJson: string,
): { zip: Uint8Array; manifest: PackageManifest } {
  const symbol = currencySymbol(ctx.currency).trim();
  const folder = "loupe-powerbi";
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
    [`${folder}/kpis.sql`]: strToU8(generateSqlFile(ctx)),
    [`${folder}/data-dictionary.csv`]: strToU8(dictionaryCsv(ctx)),
    [`${folder}/data-dictionary.md`]: strToU8(dictionaryMarkdown(ctx)),
    [`${folder}/loupe-config.json`]: strToU8(configJson),
  };
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
  };
  return { zip, manifest };
}
