"use client";

/**
 * The hero's product shot: the live dashboard preview (HeroPreview) tilted
 * back in perspective, straightening as it scrolls into place, with a accent
 * beam running round its frame. On very wide screens three of its real KPI
 * figures float in the margins beside it, drifting at their own pace as the
 * page scrolls. They show the date range chosen in the panel and say which
 * it is (they repeat what the preview shows, so they are hidden from
 * assistive technology). Under reduced motion the shot sits flat and still.
 *
 * It holds the chosen date range for both. Without JavaScript the page's
 * <noscript> rule ([data-reveal]) lays the shot flat and shows it.
 */
import * as React from "react";
import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { HeroPreview, PRESET_SHORT } from "./HeroPreview";
import { useCalm } from "./motion";
import type { LandingData, PreviewKpi, PreviewPresetId } from "./preview-data";

type PreviewData = Pick<LandingData, "file" | "detection" | "columns" | "states" | "tiles">;

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
      // From 1600px: narrower screens leave too little margin beside the panel for a card.
      className={cn("pointer-events-none absolute z-10 hidden w-[184px] min-[1600px]:block", className)}
    >
      <div
        className="glass animate-[float-y_7s_ease-in-out_infinite] rounded-card border border-border-strong px-4 py-3 shadow-lift"
        style={{ animationDelay: `${delay}s` }}
      >
        <p className="eyebrow flex items-baseline justify-between gap-2 text-fg-subtle">
          <span className="min-w-0">{kpi.name}</span>
          <span className="shrink-0">{PRESET_SHORT[range]}</span>
        </p>
        <p className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="font-figures text-xl leading-none font-medium text-fg">{kpi.display}</span>
          <span className={cn("font-figures inline-flex items-center gap-0.5 text-xs font-medium", tone)}>
            <Icon className="size-3" />
            {kpi.deltaText}
          </span>
        </p>
      </div>
    </motion.div>
  );
}

export function HeroStage({ data }: { data: PreviewData }) {
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
  const [first, second, third] = state?.kpis ?? [];
  const range = state?.id ?? "last12m";
  return (
    <div ref={ref} data-reveal data-loop className="relative mt-16 [perspective:1800px] sm:mt-20">
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
          <HeroPreview data={data} presetIndex={presetIndex} onPresetChange={setPresetIndex} />
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
