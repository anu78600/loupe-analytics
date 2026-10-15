/**
 * Regenerates CHANGELOG.md from src/content/changelog.ts (the source of truth
 * that the /changelog page renders).
 *
 * Run with `npm run changelog`. Node 24 strips the TypeScript types itself, so
 * no build step or extra dependency is needed; that is why changelog.ts must
 * stay free of imports and non-erasable syntax.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PLANNED, RELEASES } from "../src/content/changelog.ts";

const out: string[] = [];
out.push("# Version log");
out.push("");
out.push(
  "Every step of building Loupe, newest first. Generated from `src/content/changelog.ts` by `npm run changelog`; the same content is on the `/changelog` page.",
);
out.push("");
out.push("- **MAJOR** (`x.0`): a new capability, subsystem or page.");
out.push("- **MINOR** (`x.y`): a refinement, fix or follow-up to that major version.");
out.push("");

if (PLANNED.length) {
  out.push("## Up next");
  out.push("");
  PLANNED.forEach((p, i) => out.push(`${i + 1}. **${p.title}.** ${p.detail}`));
  out.push("");
}

for (const r of RELEASES) {
  out.push(`## ${r.version} · ${r.title}`);
  out.push("");
  out.push(
    `*${r.kind === "major" ? "Major" : "Minor"} · ${r.date.replace("T", " ").replace(/:\d\dZ$/, " UTC")} · ${r.tags.join(", ")}*`,
  );
  out.push("");
  out.push(r.summary);
  out.push("");
  for (const c of r.changes) out.push(`- ${c}`);
  if (r.files?.length) {
    out.push("");
    out.push(`Files: ${r.files.map((f) => `\`${f}\``).join(", ")}`);
  }
  out.push("");
}

const target = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));
writeFileSync(target, out.join("\n"), "utf8");
console.log(`Wrote ${RELEASES.length} versions to CHANGELOG.md`);
