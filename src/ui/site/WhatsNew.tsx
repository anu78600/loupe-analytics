/**
 * "What's new" (version 52.4): the highlights a user reads, before the full
 * version log a developer reads. Each month lists its new capabilities (the
 * major versions) in a line each, newest first, with how many refinements
 * and fixes (the minor versions) followed them; the full log, every step
 * with its files, stays below the highlights, folded. A server component: it
 * only lays out src/content/changelog.ts.
 */
import type { Release } from "@/content/changelog";

/** "2026-10" → "October 2026", in UTC so the static page reads the same everywhere. */
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1)).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const versionNumber = (v: string) => {
  const [major, minor] = v.split(".").map(Number);
  return (major ?? 0) * 1000 + (minor ?? 0);
};

export function WhatsNew({ releases }: { releases: readonly Release[] }) {
  const months = new Map<string, Release[]>();
  for (const r of releases) {
    const key = r.date.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), r]);
  }
  const ordered = [...months.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  return (
    <div className="grid gap-8">
      {ordered.map(([key, list]) => {
        const majors = list
          .filter((r) => r.kind === "major")
          .sort((a, b) => versionNumber(b.version) - versionNumber(a.version));
        const fixes = list.length - majors.length;
        return (
          <section
            key={key}
            aria-labelledby={`month-${key}`}
            className="rounded-panel border border-border bg-surface-1 p-5 shadow-card sm:p-6"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`month-${key}`} className="text-lg font-semibold text-fg">
                {monthLabel(key)}
              </h2>
              <p className="tabular text-xs text-fg-subtle">
                {majors.length} new capabilit{majors.length === 1 ? "y" : "ies"} · {fixes} improvement
                {fixes === 1 ? "" : "s"} and fixes
              </p>
            </div>
            <ul className="mt-4 grid gap-3">
              {majors.map((r) => (
                <li key={r.version} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3 text-sm">
                  <span className="font-figures pt-px text-xs text-fg-subtle">v{r.version}</span>
                  <span className="min-w-0">
                    <span className="font-medium text-fg">{r.title}</span>
                    <span
                      className="mt-0.5 line-clamp-2 block leading-relaxed text-fg-muted"
                      title={r.summary}
                    >
                      {r.summary}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
