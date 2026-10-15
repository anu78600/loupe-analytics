"use client";

/**
 * Minimal React wrapper around one ECharts canvas instance. ECharts loads
 * lazily (code-split) on first mount; the instance follows its container's
 * size, and is disposed on unmount. Callbacks are read through refs, so new
 * handler identities never re-create the chart. The element is a labelled
 * role="img"; the accessible data lives in the DataTable twin.
 */
import * as React from "react";
import type { EChartsCoreOption } from "echarts/core";
import type * as EChartsSetup from "./echarts-setup";
import { cn } from "@/lib/utils";

type EChartsType = EChartsSetup.EChartsType;

/** A click on a data mark (series clicks only; axis and legend clicks are ignored). */
export interface ChartClick {
  name: string;
  dataIndex: number;
  seriesIndex: number;
  data: unknown;
}

/** Imperative handle for exports. */
export interface EChartHandle {
  /** The live instance, or null before ECharts has loaded. */
  instance: () => EChartsType | null;
  /** PNG data URL at 2× pixel ratio; white background unless `transparent` or `background` is given. Null before load. */
  toPng: (opts?: { transparent?: boolean; background?: string }) => string | null;
  /** Vector SVG of the current option, rendered off-screen at the element's size. */
  toSvg: () => Promise<string | null>;
}

interface Props {
  option: EChartsCoreOption | null;
  /** Changing this forces a clean re-render (e.g. when the chart kind changes). */
  resetKey: string;
  className?: string;
  ariaLabel: string;
  onClick?: (p: ChartClick) => void;
  /** Category indices of the visible window after an inside (wheel/drag) zoom. */
  onZoom?: (startIndex: number, endIndex: number) => void;
}

let loader: Promise<typeof EChartsSetup> | null = null;
/** Memoised dynamic import of the tree-shaken ECharts build, shared by every chart and the report export. */
export const loadECharts = () => (loader ??= import("./echarts-setup"));

export const EChart = React.forwardRef<EChartHandle, Props>(function EChart(
  { option, resetKey, className, ariaLabel, onClick, onZoom },
  ref,
) {
  const el = React.useRef<HTMLDivElement>(null);
  const inst = React.useRef<EChartsType | null>(null);
  const lastKey = React.useRef<string>("");
  const clickRef = React.useRef(onClick);
  const zoomRef = React.useRef(onZoom);
  const optionRef = React.useRef(option);
  clickRef.current = onClick;
  zoomRef.current = onZoom;
  optionRef.current = option;
  const [ready, setReady] = React.useState(false);

  // Create the instance once. `disposed` covers an unmount (or a StrictMode
  // re-run) that happens before the async import resolves.
  React.useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    void loadECharts().then((mod) => {
      if (disposed || !el.current) return;
      const chart = mod.default.init(el.current, undefined, { renderer: "canvas" });
      inst.current = chart;
      chart.on("click", (p: unknown) => {
        const e = p as {
          name: string;
          dataIndex: number;
          seriesIndex: number;
          data: unknown;
          componentType: string;
        };
        if (e.componentType === "series")
          clickRef.current?.({
            name: e.name,
            dataIndex: e.dataIndex,
            seriesIndex: e.seriesIndex,
            data: e.data,
          });
      });
      // The event payload carries percentages; the resolved option has the window as axis values (indices).
      chart.on("datazoom", () => {
        const opt = chart.getOption() as { dataZoom?: Array<{ startValue?: number; endValue?: number }> };
        const dz = opt.dataZoom?.[0];
        if (dz && typeof dz.startValue === "number" && typeof dz.endValue === "number")
          zoomRef.current?.(dz.startValue, dz.endValue);
      });
      // Follow the grid cell's size (layout changes, not just window resizes), without animating.
      ro = new ResizeObserver(() => chart.resize({ animation: { duration: 0 } }));
      ro.observe(el.current);
      setReady(true);
    });
    return () => {
      disposed = true;
      ro?.disconnect();
      inst.current?.dispose();
      inst.current = null;
    };
  }, []);

  React.useEffect(() => {
    const chart = inst.current;
    if (!ready || !chart) return;
    if (!option) {
      chart.clear();
      return;
    }
    // A new resetKey (e.g. kind, theme or drill level) rebuilds from scratch. Otherwise
    // merge, so data changes animate, while replacing the structural components
    // so a removed series or axis does not linger from the previous option.
    const fresh = lastKey.current !== resetKey;
    lastKey.current = resetKey;
    chart.setOption(
      option,
      fresh
        ? { notMerge: true }
        : {
            replaceMerge: ["series", "xAxis", "yAxis", "legend", "visualMap", "graphic", "dataZoom", "grid"],
          },
    );
  }, [option, resetKey, ready]);

  React.useImperativeHandle(ref, () => ({
    instance: () => inst.current,
    toPng: ({ transparent, background } = {}) =>
      inst.current?.getDataURL({
        type: "png",
        pixelRatio: 2,
        backgroundColor: transparent ? "transparent" : (background ?? "#ffffff"),
      }) ?? null,
    // The live chart draws on canvas, so vector output comes from a throwaway
    // server-side-rendering SVG instance fed the same option.
    toSvg: async () => {
      const current = optionRef.current;
      if (!current || !el.current) return null;
      const mod = await loadECharts();
      const w = el.current.clientWidth || 800;
      const h = el.current.clientHeight || 400;
      const tmp = mod.default.init(null, undefined, { renderer: "svg", ssr: true, width: w, height: h });
      tmp.setOption({ ...current, animation: false } as EChartsCoreOption);
      const svg = tmp.renderToSVGString();
      tmp.dispose();
      return svg;
    },
  }));

  return <div ref={el} role="img" aria-label={ariaLabel} className={cn("h-full w-full", className)} />;
});
