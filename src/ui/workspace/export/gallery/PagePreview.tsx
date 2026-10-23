"use client";

/**
 * The one-page dashboard's preview in the Export gallery (version 50.4): the
 * page exactly as it downloads. It is drawn the way the download is
 * (exportOnePage: OnePage rendered off-screen at 1280 × 720 in the light
 * theme, then captured), only at one times the size and kept as a picture in
 * the card, so the preview is the file, with its own figures, charts and
 * insights.
 *
 * Until the picture is ready, and if it can't be made, MiniPage stands in:
 * the page's layout in outline (banner, filter pills, the KPI tiles, the
 * charts in their places, the insights column), drawn from the same model,
 * so the card is never a blank area. The picture is redrawn when the page
 * changes (filters, a recompute, the insights arriving, the chart colours),
 * once the dashboard has finished computing.
 */
import * as React from "react";
import { useWorkspace } from "@/store/workspace";
import { cn } from "@/lib/utils";
import { useChartThemeKey } from "@/ui/common/hooks";
import { renderOffscreen } from "../report";
import { OnePage, PAGE_W, type PageModel } from "../../dashboard/page/OnePage";

/** How long the page must stay unchanged before it is drawn, so a burst of updates draws once. */
const SETTLE_MS = 450;

/** Draws the page as the download does, at 1280 × 720, as a JPEG data URL. */
async function drawPage(model: PageModel): Promise<string> {
  const { host, cleanup } = await renderOffscreen(<OnePage model={model} live={false} />, PAGE_W);
  try {
    const node = host.querySelector<HTMLElement>("[data-page]");
    if (!node) throw new Error("The page couldn't be laid out.");
    const { toJpeg } = await import("html-to-image");
    // The light theme's page colour (the page's own background token), under anything transparent.
    const backgroundColor = getComputedStyle(node).backgroundColor;
    return await toJpeg(node, { pixelRatio: 1, quality: 0.9, backgroundColor });
  } finally {
    cleanup();
  }
}

/**
 * The page's picture, redrawn when it changes. `drawing` is true from a
 * change until its picture is ready, and false once an attempt failed (the
 * outline then stays, still).
 */
function usePageSnapshot(model: PageModel): { url: string | null; drawing: boolean } {
  // Settled: nothing is being computed, so the page shows final figures.
  const settled = useWorkspace((s) => !s.computing && Boolean(s.lastCompute) && !s.insightsLoading);
  // Only the chart colours and the fonts matter: the picture is always in the light theme.
  const colours = useChartThemeKey().split("|").slice(1).join("|");
  const [shot, setShot] = React.useState<{ model: PageModel; colours: string; url: string } | null>(null);
  const [failedFor, setFailedFor] = React.useState<PageModel | null>(null);
  React.useEffect(() => {
    if (!settled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      drawPage(model).then(
        (url) => {
          if (!cancelled) setShot({ model, colours, url });
        },
        () => {
          if (!cancelled) setFailedFor(model);
        },
      );
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [model, settled, colours]);
  const current = shot?.model === model && shot.colours === colours;
  return { url: shot?.url ?? null, drawing: !current && failedFor !== model };
}

/**
 * The page in outline, in its real proportions: the banner, the row of filter
 * pills, the KPI tiles (each with its icon chip in the KPI's chart colour),
 * the charts in their places on the bento, and the insights column beside
 * them. Sized by the paper it sits on (cqw), as the real page is by its width.
 */
export function MiniPage({ model, className }: { model: PageModel; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "grid size-full grid-rows-[11%_6%_17%_minmax(0,1fr)] gap-[0.9cqw] bg-bg p-[1.25cqw]",
        className,
      )}
    >
      <div className="flex items-center gap-[0.8cqw]">
        <span className="aspect-square h-[70%] rounded-xs bg-accent-soft ring-1 ring-border-accent" />
        <span className="flex h-full flex-1 flex-col justify-center gap-[0.5cqw]">
          <span className="h-[26%] w-[34%] rounded-full bg-fg/75" />
          <span className="h-[16%] w-[22%] rounded-full bg-fg-subtle/40" />
        </span>
        <span className="h-[18%] w-[16%] rounded-full bg-fg-subtle/40" />
      </div>
      <div className="flex gap-[0.6cqw]">
        {Array.from({ length: 1 + model.slicers.length }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-full w-[10%] rounded-full ring-1",
              i === 0 ? "bg-accent-soft ring-border-accent" : "bg-surface-1 ring-border",
            )}
          />
        ))}
      </div>
      <div
        className="grid gap-[0.9cqw]"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, model.kpis.length)}, minmax(0, 1fr))` }}
      >
        {model.kpis.map((k, i) => (
          <div
            key={k.meta.id}
            className="flex flex-col justify-between rounded-xs bg-surface-1 p-[0.7cqw] ring-1 ring-border"
          >
            <span className="flex items-center gap-[0.5cqw]">
              <span
                className="aspect-square h-[1.6cqw] rounded-[2px]"
                style={{
                  background: `color-mix(in oklab, var(--chart-${(i % 8) + 1}) 45%, var(--surface-1))`,
                }}
              />
              <span className="h-[0.7cqw] w-[45%] rounded-full bg-fg-subtle/40" />
            </span>
            <span className="h-[1.6cqw] w-[60%] rounded-full bg-fg/70" />
          </div>
        ))}
      </div>
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_21%] gap-[0.9cqw]">
        <div className="grid min-h-0 grid-cols-6 grid-rows-2 gap-[0.9cqw]">
          {model.charts.map((c) => (
            <div
              key={c.spec.id}
              className="[grid-column:span_var(--span)/span_var(--span)] [grid-row:span_var(--rows)/span_var(--rows)] flex flex-col gap-[0.6cqw] rounded-xs bg-surface-1 p-[0.8cqw] ring-1 ring-border"
              style={{ "--span": c.span, "--rows": c.tall ? 2 : 1 } as React.CSSProperties}
            >
              <span className="h-[0.8cqw] w-[40%] shrink-0 rounded-full bg-fg/60" />
              <span className="h-[0.6cqw] w-[65%] shrink-0 rounded-full bg-fg-subtle/30" />
              <span className="min-h-0 flex-1 rounded-[2px] bg-surface-2" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-[1cqw] rounded-xs bg-surface-1 p-[0.9cqw] ring-1 ring-border">
          <span className="h-[0.8cqw] w-[50%] rounded-full bg-fg/60" />
          {Array.from({ length: Math.max(1, model.insights.length) }, (_, i) => (
            <span key={i} className="flex gap-[0.6cqw]">
              <span className="aspect-square h-[1.8cqw] shrink-0 rounded-full bg-accent-soft" />
              <span className="flex flex-1 flex-col gap-[0.5cqw] pt-[0.2cqw]">
                <span className="h-[0.7cqw] w-[90%] rounded-full bg-fg/50" />
                <span className="h-[0.6cqw] w-[70%] rounded-full bg-fg-subtle/30" />
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The featured card's preview: the page's picture on a sheet of paper in the
 * middle of the stage, lifting a little when the card is hovered. The outline
 * shows (breathing softly) while the picture is drawn.
 */
export function PagePreview({ model }: { model: PageModel }) {
  const { url, drawing } = usePageSnapshot(model);
  // The picture on show; a newer one loads out of sight first and replaces it once decoded, so a
  // redraw never flashes back to the outline. The first one fades in over the outline.
  const [shown, setShown] = React.useState<string | null>(null);
  return (
    <div className="absolute inset-0 grid place-items-center">
      {/* Always the light theme: the page downloads in it, whatever the app's theme. */}
      <div
        data-theme="light"
        className={cn(
          // Dimmed a little in the dark theme, as pictures are, so the white page doesn't glare.
          "[container-type:inline-size] relative aspect-video w-[min(88cqw,calc(82cqh*16/9))] overflow-hidden rounded-sm bg-bg shadow-pop ring-1 ring-border dark:brightness-[0.88]",
          "transition-[translate,box-shadow] duration-slow ease-out-quint group-hover:shadow-lift motion-safe:group-hover:-translate-y-1",
        )}
      >
        <MiniPage model={model} className={cn(drawing && !shown && "motion-safe:animate-pulse-soft")} />
        {/* Data URLs drawn in this tab: next/image has nothing to optimise. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shown ?? undefined}
          alt=""
          draggable={false}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-slow ease-out-quint",
            shown ? "opacity-100" : "opacity-0",
          )}
        />
        {url && url !== shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            onLoad={() => setShown(url)}
            className="pointer-events-none absolute size-px opacity-0"
          />
        ) : null}
      </div>
    </div>
  );
}
