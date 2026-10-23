"use client";

/**
 * The hero's product shot: the live dashboard preview (HeroPreview) tilted
 * back in perspective, straightening as it scrolls into place, with an accent
 * beam running round its frame. From the xl breakpoint it is wider than the
 * hero's text, as a window on the workspace. On very wide screens three of its
 * real KPI figures float in the margins beside it, drifting at their own pace
 * as the page scrolls. They show the period chosen in the panel and say which
 * it is (they repeat what the preview shows, so they are hidden from assistive
 * technology). Under reduced motion the shot sits flat and still.
 *
 * It holds the chosen period for both. Without JavaScript the page's
 * <noscript> rule ([data-reveal]) lays the shot flat and shows it.
 */
import * as React from "react";
import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { HeroPreview, PRESET_SHORT, type HeroData } from "./HeroPreview";
import { useCalm } from "./motion";
import type { PreviewKpi, PreviewPresetId } from "./preview-data";

/** The figures that float beside the panel, by KPI id: the revenue, the basket and the returns story. */
const FLOATING = ["net_revenue", "aov", "rto_rate"];

function FloatingKpi({
  kpi,
  range,
  y,
  className,
  delay,
}: {
  kpi: PreviewKpi;
  range: PreviewPresetId;
  y: MotionValue<number> | undefined;
  className: string;
  delay: number;
}) {
  const Icon = kpi.change === "up" ? ArrowUpRight : kpi.change === "down" ? ArrowDownRight : Minus;
  const tone =
    kpi.tone === "good" ? "text-success-text" : kpi.tone === "bad" ? "text-danger-text" : "text-fg-muted";
  return (
    <motion.div
      aria-hidden
      style={y ? { y } : undefined}
      // From 1680px: narrower screens leave too little margin beside the panel for a card.
      className={cn("pointer-events-none absolute z-10 hidden w-[184px] min-[1680px]:block", className)}
    >
      <div
        className="glass animate-[float-y_7s_ease-in-out_infinite] rounded-card border border-border-strong px-4 py-3 shadow-lift"
        style={{ animationDelay: `${delay}s` }}
      >
        <p className="flex items-baseline justify-between gap-2 text-xs">
          <span className="min-w-0 truncate font-medium text-fg-muted">{kpi.name}</span>
          <span className="eyebrow shrink-0 text-fg-subtle">{PRESET_SHORT[range]}</span>
        </p>
        <p className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="font-figures text-xl leading-none font-semibold text-fg">{kpi.display}</span>
          <span className={cn("font-figures inline-flex items-center gap-0.5 text-xs font-medium", tone)}>
            <Icon className="size-3" />
            {kpi.deltaText}
          </span>
        </p>
      </div>
    </motion.div>
  );
}

export function HeroStage({ data, icon }: { data: HeroData; icon: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const reduce = useCalm();
  const [presetIndex, setPresetIndex] = React.useState(0);
  // 0 when the shot's top enters at the bottom of the screen, 1 when it has risen to a quarter from the top.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start 0.22"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [15, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.93, 1]);
  const rise = useTransform(scrollYProgress, [0, 1], [90, -40]);
  const sink = useTransform(scrollYProgress, [0, 1], [-30, 60]);
  const state = data.states[presetIndex] ?? data.states[0];
  const kpis = state?.kpis ?? [];
  const pick = (id: string, fallback: number) => kpis.find((k) => k.id === id) ?? kpis[fallback];
  const [first, second, third] = FLOATING.map((id, i) => pick(id, i * 2));
  const range = state?.id ?? "last12m";
  return (
    <div ref={ref} data-reveal data-loop className="relative mt-12 [perspective:1800px] sm:mt-14 xl:-mx-16">
      <motion.div
        style={reduce ? undefined : { rotateX, scale, transformOrigin: "50% 0%" }}
        className="relative"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-16 -top-24 bottom-10 -z-10 bg-[radial-gradient(55%_50%_at_50%_30%,var(--glow-accent),transparent_70%)] opacity-60 blur-2xl"
        />
        <div className="relative rounded-panel">
          <span aria-hidden className="beam-ring" />
          <HeroPreview data={data} icon={icon} presetIndex={presetIndex} onPresetChange={setPresetIndex} />
        </div>
      </motion.div>
      {first ? (
        <FloatingKpi
          kpi={first}
          range={range}
          y={reduce ? undefined : rise}
          className="top-[14%] right-full mr-6"
          delay={0}
        />
      ) : null}
      {second ? (
        <FloatingKpi
          kpi={second}
          range={range}
          y={reduce ? undefined : sink}
          className="top-[36%] left-full ml-6"
          delay={1.4}
        />
      ) : null}
      {third ? (
        <FloatingKpi
          kpi={third}
          range={range}
          y={reduce ? undefined : rise}
          className="top-[62%] right-full mr-3"
          delay={2.6}
        />
      ) : null}
    </div>
  );
}
