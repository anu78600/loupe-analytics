/**
 * npm run corpus: downloads the public test files listed in
 * scripts/corpus-manifest.json into .corpus/ (git-ignored), for npm run audit.
 * The files are public datasets (open data portals, sample data of Microsoft,
 * Tableau, Maven, UCI and others), each with its source and licence in the
 * manifest; none is ever committed. Files already downloaded are kept.
 *
 * Only direct downloads are fetched. A file the manifest says was extracted
 * from a zip, or cut from a larger file, is listed at the end to fetch by hand
 * (its manifest entry says how), and the audit simply skips it until then.
 * This runs on a developer's machine only: the app itself makes no such call.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = ".corpus";
const manifest = JSON.parse(readFileSync("scripts/corpus-manifest.json", "utf8"));
const byHand = (e) =>
  /\.zip(\?|$)/i.test(e.url) || /extracted from zip|first \d+ ?MB|subset|cut at/i.test(e.what);

let fetched = 0;
let kept = 0;
const failed = [];
const manual = [];
for (const e of manifest) {
  const path = join(ROOT, e.file);
  if (existsSync(path)) {
    kept++;
    continue;
  }
  if (byHand(e)) {
    manual.push(e);
    continue;
  }
  try {
    const res = await fetch(e.url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    fetched++;
    console.log(`fetched ${e.file}`);
  } catch (err) {
    failed.push(`${e.file}: ${err.message}`);
  }
}
console.log(
  `\n${fetched} downloaded, ${kept} already there, ${failed.length} failed, ${manual.length} to fetch by hand.`,
);
for (const f of failed) console.log(`  failed: ${f}`);
if (manual.length) {
  console.log("\nTo fetch by hand into .corpus/ (see each entry in scripts/corpus-manifest.json):");
  for (const e of manual) console.log(`  ${e.file}  ←  ${e.url}`);
}
