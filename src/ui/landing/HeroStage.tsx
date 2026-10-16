"use client";

/**
 * The hero's product shot: the live dashboard preview (HeroPreview) tilted
 * back in perspective, straightening as it scrolls into place, with a brass
 * beam running round its frame. On very wide screens three of its real KPI
 * figures float in the margins beside it, drifting at their own pace as the
 * page scrolls (they repeat what the preview shows, so they are hidden from
 * assistive technology). Under reduced motion the shot sits flat and still.
 */
import * as React from "react";
import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { HeroPreview } from "./HeroPreview";
import { useCalm } from "./motion";
import type { LandingData, PreviewKpi } from "./preview-data";

type PreviewData = Pick<LandingData, "file" | "detection" | "columns" | "states" | "tiles">;

function FloatingKpi({
  kpi,
  y,
  className,
  delay,
}: {
  kpi: PreviewKpi;
  y: MotionValue<number> | undefined;
  className: string;
  delay: number;
}) {
  const Icon = kpi.change === "up" ? ArrowUpRight : kpi.change === "down" ? ArrowDownRight : Minus;
  const tone = kpi.tone === "good" ? "text-success" : kpi.tone === "bad" ? "text-danger" : "text-fg-muted";
  return (
    <motion.div
      aria-hidden
      style={y ? { y } : undefined}
      className={cn("pointer-events-none absolute z-10 hidden w-[184px] 2xl:block", className)}
    >
      <div
        className="glass animate-[float-y_7s_ease-in-out_infinite] rounded-card border border-border-strong px-4 py-3 shadow-lift"
        style={{ animationDelay: `${delay}s` }}
      >
        <p className="truncate text-2xs font-medium tracking-[0.1em] text-fg-subtle uppercase">{kpi.name}</p>
        <p className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="font-figures text-[22px] leading-none font-medium tracking-[-0.02em] text-fg">
            {kpi.display}
          </span>
          <span className={cn("font-figures inline-flex items-center gap-0.5 text-[11px] font-medium", tone)}>
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
  // 0 when the shot's top enters at the bottom of the screen, 1 when it has risen to a quarter from the top.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start 0.22"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [15, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.93, 1]);
  const rise = useTransform(scrollYProgress, [0, 1], [90, -40]);
  const sink = useTransform(scrollYProgress, [0, 1], [-30, 60]);
  const kpis = data.states[0]?.kpis ?? [];
  const [first, second, third] = kpis;
  return (
    <div ref={ref} className="relative mt-16 [perspective:1800px] sm:mt-20">
      <motion.div
        style={reduce ? undefined : { rotateX, scale, transformOrigin: "50% 0%" }}
        className="relative"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-16 -top-24 bottom-10 -z-10 bg-[radial-gradient(55%_50%_at_50%_30%,var(--glow-accent),transparent_70%)] opacity-60 blur-2xl"
        />
        <div className="beam-border rounded-panel">
          <HeroPreview data={data} />
        </div>
      </motion.div>
      {first ? (
        <FloatingKpi
          kpi={first}
          y={reduce ? undefined : rise}
          className="top-[14%] right-full mr-6"
          delay={0}
        />
      ) : null}
      {second ? (
        <FloatingKpi
          kpi={second}
          y={reduce ? undefined : sink}
          className="top-[36%] left-full ml-6"
          delay={1.4}
        />
      ) : null}
      {third ? (
        <FloatingKpi
          kpi={third}
          y={reduce ? undefined : rise}
          className="top-[62%] right-full mr-3"
          delay={2.6}
        />
      ) : null}
    </div>
  );
}
