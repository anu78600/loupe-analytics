"use client";

/**
 * Version log timeline for /changelog.
 *
 * Releases are grouped by major version, newest group first. Inside a group
 * the major release comes first, then its minor follow-ups, newest first like
 * the rest of the page. A filter hides the minors. Times are rendered in UTC
 * on the server and switch to the visitor's local time, with its zone named,
 * after hydration (useSyncExternalStore avoids a hydration mismatch without
 * effects).
 */
import * as React from "react";
import { ChevronRight, FileCode2 } from "lucide-react";
import type { Release } from "@/content/changelog";
import { cn } from "@/lib/utils";

const subscribe = () => () => {};

/** "12.3" → [12, 3]. Kept local so the client bundle doesn't import the whole log. */
function parseVersion(version: string): [number, number] {
  const [major, minor] = version.split(".").map(Number);
  return [major ?? 0, minor ?? 0];
}

/** Formats an ISO timestamp: UTC on the server, local time in the browser, each saying its zone. */
function Timestamp({ iso }: { iso: string }) {
  const isClient = React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const date = new Date(iso);
  const text = isClient
    ? new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(date)
    : `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(date)} UTC`;
  return (
    <time dateTime={iso} className="tabular text-xs text-fg-subtle" suppressHydrationWarning>
      {text}
    </time>
  );
}

function KindBadge({ kind }: { kind: Release["kind"] }) {
  return kind === "major" ? (
    <span className="eyebrow rounded-full border border-border-accent bg-accent-soft px-2 py-0.5 text-accent">
      Major
    </span>
  ) : (
    <span className="eyebrow rounded-full border border-border-strong px-2 py-0.5 text-fg-muted">Minor</span>
  );
}

function Files({ files }: { files: string[] }) {
  return (
    <details className="group mt-3">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-[6px] text-xs text-fg-subtle transition-colors hover:text-fg [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" aria-hidden />
        <FileCode2 className="size-3" aria-hidden />
        {files.length} file{files.length === 1 ? "" : "s"} changed
      </summary>
      <ul className="mt-2 grid gap-1 pl-5 text-xs text-fg-muted">
        {files.map((f) => (
          <li key={f} className="break-all">
            {f}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Entry({ release, compact }: { release: Release; compact: boolean }) {
  return (
    <article
      id={`v${release.version}`}
      className="scroll-mt-24"
      aria-labelledby={`v${release.version}-title`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <a
          href={`#v${release.version}`}
          className={cn(
            "font-figures font-medium text-fg hover:text-accent",
            compact ? "text-ui" : "text-md",
          )}
        >
          v{release.version}
        </a>
        <KindBadge kind={release.kind} />
        {release.tags.map((t) => (
          <span key={t} className="text-xs text-fg-subtle">
            {t}
          </span>
        ))}
        <span className="ml-auto">
          <Timestamp iso={release.date} />
        </span>
      </div>
      <h3
        id={`v${release.version}-title`}
        className={cn("mt-2 text-fg", compact ? "text-base font-semibold" : "font-display text-display-xs")}
      >
        {release.title}
      </h3>
      <p className={cn("mt-2 leading-relaxed text-fg-muted", compact ? "text-md" : "text-base")}>
        {release.summary}
      </p>
      <ul className="mt-3 grid gap-1.5">
        {release.changes.map((c) => (
          <li key={c} className="grid grid-cols-[12px_1fr] gap-2 text-sm leading-relaxed text-fg-muted">
            <span aria-hidden className="mt-[0.65em] size-1 rounded-full bg-fg-subtle" />
            {c}
          </li>
        ))}
      </ul>
      {release.files?.length ? <Files files={release.files} /> : null}
    </article>
  );
}

type Filter = "all" | "major";

export function ChangelogTimeline({ releases }: { releases: Release[] }) {
  const [filter, setFilter] = React.useState<Filter>("all");

  // Group by major number, newest major first; inside, newest first (the major heads its group).
  const groups = React.useMemo(() => {
    const byMajor = new Map<number, Release[]>();
    for (const r of releases) {
      const [major] = parseVersion(r.version);
      byMajor.set(major, [...(byMajor.get(major) ?? []), r]);
    }
    return [...byMajor.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([major, list]) => ({
        major,
        list: [...list].sort((a, b) => parseVersion(b.version)[1] - parseVersion(a.version)[1]),
      }));
  }, [releases]);

  return (
    <div>
      <div
        role="group"
        aria-label="Show"
        className="inline-flex items-center rounded-control border border-border bg-surface-1 p-1"
      >
        {(
          [
            { id: "all", label: "All steps" },
            { id: "major", label: "Major versions only" },
          ] as const
        ).map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={filter === o.id}
            onClick={() => setFilter(o.id)}
            className={cn(
              "rounded-[8px] px-3 py-1.5 text-ui transition-colors",
              filter === o.id ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      <ol
        className="relative mt-10 grid gap-8 before:absolute before:inset-y-2 before:left-[7px] before:w-px before:bg-border-strong"
        aria-label="Versions, newest first"
      >
        {groups.map(({ major, list }) => {
          const head = list.find((r) => r.kind === "major");
          const minors = list.filter((r) => r.kind === "minor");
          return (
            <li key={major} className="relative pl-9">
              <span
                aria-hidden
                className="absolute top-1.5 left-0 size-[15px] rounded-full border-2 border-accent bg-bg shadow-[0_0_0_4px_var(--bg)]"
              />
              <div className="rounded-panel border border-border bg-surface-1 p-5 shadow-card sm:p-6">
                {head ? <Entry release={head} compact={false} /> : null}
                {filter === "all" && minors.length ? (
                  <div className="mt-6 border-t border-border pt-5">
                    <p className="eyebrow text-fg-subtle">
                      {minors.length} follow-up{minors.length === 1 ? "" : "s"} to version {major}
                    </p>
                    <ol className="mt-4 grid gap-6">
                      {minors.map((m) => (
                        <li key={m.version} className="relative border-l border-border pl-4">
                          <Entry release={m} compact />
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
                {filter === "major" && minors.length ? (
                  <p className="mt-4 text-xs text-fg-subtle">
                    + {minors.length} minor follow-up{minors.length === 1 ? "" : "s"} (
                    {minors.map((m) => `v${m.version}`).join(", ")})
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
