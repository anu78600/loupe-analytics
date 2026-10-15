"use client";

/**
 * Gauge-style ring for detection confidence (0–100). Brass at 70 and above
 * (the confirmation threshold), warning below 70 and danger below 50. The
 * figure counts up and the arc springs into place; both respect reduced
 * motion.
 */
import * as React from "react";
import { motion } from "framer-motion";
import { useCountUp } from "@/ui/common/hooks";
import { cn } from "@/lib/utils";

export function ConfidenceRing({
  value,
  size = 132,
  label = "confidence",
  className,
}: {
  value: number;
  size?: number;
  label?: string;
  className?: string;
}) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const shown = useCountUp(value, 900) ?? 0;
  const color = value >= 70 ? "var(--accent)" : value >= 50 ? "var(--warning)" : "var(--danger)";
  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${Math.round(value)}% ${label}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={stroke}
        />
        {Array.from({ length: 40 }, (_, i) => {
          const a = (i / 40) * Math.PI * 2;
          const r1 = r + stroke / 2 + 3;
          const r2 = r1 + (i % 5 === 0 ? 4 : 2);
          return (
            <line
              key={i}
              x1={size / 2 + Math.cos(a) * r1}
              y1={size / 2 + Math.sin(a) * r1}
              x2={size / 2 + Math.cos(a) * r2}
              y2={size / 2 + Math.sin(a) * r2}
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
          );
        })}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ type: "spring", stiffness: 60, damping: 18, mass: 1 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-[30px] leading-none font-semibold tracking-[-0.03em] text-fg">
          {Math.round(shown)}
          <span className="text-[15px] font-medium text-fg-muted">%</span>
        </span>
        <span className="mt-1 text-2xs tracking-[0.12em] text-fg-subtle uppercase">{label}</span>
      </div>
    </div>
  );
}
