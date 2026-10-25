/**
 * "In the glossary ↗" (version 52.4): the link from a KPI's details or a
 * chart's "Why this chart" to its entry on /glossary, so a term is explained
 * where it is used, not only on a page to browse. It opens in a new tab, so
 * the data loaded in the workspace stays. The anchors are the glossary's own
 * (ui/site/Glossary.tsx): "#kpi-<industry>--<kpi>" opens the industry's tab
 * on that KPI, "#chart-<kind>" a chart type.
 */
import { ArrowUpRight } from "lucide-react";
import { isColumnId } from "@/engine/kpi/columnKpis";
import { isUserKpiId } from "@/engine/kpi/userKpis";
import { cn } from "@/lib/utils";

/** The glossary entry of a template KPI; null for the data-led dashboard and for column or user KPIs, which have none. */
export function kpiGlossaryHref(domainId: string, kpiId: string): string | null {
  if (domainId === "generic" || isColumnId(kpiId) || isUserKpiId(kpiId)) return null;
  return `/glossary#kpi-${domainId}--${kpiId}`;
}

export function chartGlossaryHref(kind: string): string {
  return `/glossary#chart-${kind}`;
}

export function GlossaryLink({ href, className }: { href: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-sm text-xs font-medium text-accent-text underline-offset-2 hover:underline focus-visible:focus-ring",
        className,
      )}
    >
      In the glossary
      <ArrowUpRight className="size-3" aria-hidden />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
