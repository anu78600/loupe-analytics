"use client";

/** Dependency-free trend line for the KPI cards: plain SVG, no ECharts load. */
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Lightweight SVG sparkline (no chart library): soft area, 1.75px line, end
 * dot, and a dashed final segment when the last period is incomplete.
 * Null and non-finite values are skipped (neighbours are joined) but keep
 * their x position. Fewer than two points render an empty placeholder.
 * Decorative unless `label` is given.
 */
export function Sparkline({
  values,
  className,
  color = "var(--accent)",
  partialLast = false,
  height = 36,
  label,
}: {
  values: Array<number | null>;
  className?: string;
  color?: string;
  partialLast?: boolean;
  height?: number;
  label?: string;
}) {
  // React ids can contain ':', which breaks the url(#…) gradient reference.
  const id = React.useId().replace(/:/g, "");
  const pts = values
    .map((v, i) => ({ i, v }))
    .filter((p): p is { i: number; v: number } => p.v !== null && Number.isFinite(p.v));
  if (pts.length < 2) return <div className={cn("h-9", className)} aria-hidden />;
  const W = 120;
  const H = height;
  const pad = 3;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  // A flat series would divide by zero; fall back to its magnitude (or 1 for all zeros).
  const span = max - min || Math.abs(max) || 1;
  const x = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);
  const solid = partialLast ? pts.slice(0, -1) : pts;
  const path = solid.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}`).join(" ");
  const last = pts[pts.length - 1] as { i: number; v: number };
  const prev = pts[pts.length - 2] as { i: number; v: number };
  const area = `${path} L${x((solid[solid.length - 1] as { i: number }).i).toFixed(2)},${H} L${x((solid[0] as { i: number }).i).toFixed(2)},${H} Z`;
  // The viewBox stretches to the container (preserveAspectRatio="none");
  // non-scaling strokes keep line widths and the dot outline crisp anyway.
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("h-9 w-full overflow-visible", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${id})`} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {partialLast ? (
        <path
          d={`M${x(prev.i)},${y(prev.v)} L${x(last.i)},${y(last.v)}`}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
          opacity={0.7}
        />
      ) : null}
      <circle
        cx={x(last.i)}
        cy={y(last.v)}
        r={2.4}
        fill={color}
        stroke="var(--surface-1)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
