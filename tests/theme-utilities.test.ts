/**
 * Class merging knows the design system's own utility names (version 48.0).
 * Components pass classes through cn() (src/lib/utils.ts, tailwind-merge), so
 * an override such as `cn("duration-fast", className)` has to drop the earlier
 * class of the same kind. tailwind-merge only knows Tailwind's stock scales:
 * a name it doesn't recognise is kept beside the one meant to replace it, and
 * the stylesheet's order decides which wins. These checks read the scales
 * straight from globals.css @theme (radius, motion, shadows, opacities, easing,
 * animations, text sizes), so a name added there must be taught to cn() too,
 * and they check that names of different kinds (a radius and a shadow, a ring
 * width and the focus colour) never knock each other out.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

/** The custom properties declared in globals.css's @theme block, by name without the dashes. */
function themeNames(): string[] {
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const block = /@theme inline \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  return [...block.matchAll(/--([\w-]+):/g)].map((m) => m[1] as string);
}

/** The names under one namespace (`--radius-card` → `card`), without sub-properties (`--text-xs--line-height`). */
function scale(namespace: string): string[] {
  return themeNames()
    .filter((n) => n.startsWith(`${namespace}-`) && !n.slice(namespace.length + 1).includes("--"))
    .map((n) => n.slice(namespace.length + 1));
}

/** Each @theme namespace, its utility prefix, and a stock Tailwind class of the same kind. */
const SCALES = [
  { namespace: "radius", prefix: "rounded", stock: "rounded-lg" },
  { namespace: "transition-duration", prefix: "duration", stock: "duration-200" },
  { namespace: "shadow", prefix: "shadow", stock: "shadow-md" },
  { namespace: "opacity", prefix: "opacity", stock: "opacity-50" },
  { namespace: "ease", prefix: "ease", stock: "ease-in" },
  { namespace: "animate", prefix: "animate", stock: "animate-spin" },
  { namespace: "text", prefix: "text", stock: "text-[13px]" },
] as const;

describe("cn() and the theme's own names", () => {
  it("finds the scales in @theme", () => {
    expect(scale("radius")).toEqual(["xs", "sm", "control", "card", "panel"]);
    expect(scale("transition-duration")).toEqual(["fast", "base", "slow", "chart"]);
    expect(scale("opacity")).toEqual(expect.arrayContaining(["disabled", "chart-dim"]));
    expect(scale("shadow")).toEqual(expect.arrayContaining(["card", "pop", "lift", "focus"]));
  });

  it.each(SCALES)(
    "lets a later $prefix-* class win, for every name in --$namespace-*",
    ({ namespace, prefix, stock }) => {
      const names = scale(namespace);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        const ours = `${prefix}-${name}`;
        // Against a stock class of the same kind, in both orders.
        expect(cn(ours, stock), `${ours} then ${stock}`).toBe(stock);
        expect(cn(stock, ours), `${stock} then ${ours}`).toBe(ours);
        // Against each other name on the same scale.
        for (const other of names)
          if (other !== name) expect(cn(ours, `${prefix}-${other}`)).toBe(`${prefix}-${other}`);
        // Only within the same variant: a hover class never replaces the resting one.
        expect(cn(ours, `hover:${stock}`)).toBe(`${ours} hover:${stock}`);
        expect(cn(`hover:${ours}`, `hover:${stock}`)).toBe(`hover:${stock}`);
      }
    },
  );

  it("merges the names a component overrides most", () => {
    expect(cn("duration-fast", "duration-slow")).toBe("duration-slow");
    expect(cn("transition-colors duration-fast", "duration-base")).toBe("transition-colors duration-base");
    expect(cn("disabled:opacity-disabled", "disabled:opacity-60")).toBe("disabled:opacity-60");
    expect(cn("opacity-chart-dim", "opacity-100")).toBe("opacity-100");
    expect(cn("rounded-control", "rounded-xs")).toBe("rounded-xs");
    expect(cn("rounded-sm", "rounded-card")).toBe("rounded-card");
    expect(cn("rounded-panel", "rounded-[8px]")).toBe("rounded-[8px]");
    expect(cn("shadow-card", "shadow-none")).toBe("shadow-none");
    expect(cn("shadow-pop", "shadow-focus")).toBe("shadow-focus");
    expect(cn("ease-out-quint", "ease-linear")).toBe("ease-linear");
    // The focus colour is a ring colour: it replaces another ring colour and keeps the ring's width.
    expect(cn("ring-accent-ring", "ring-focus")).toBe("ring-focus");
    expect(cn("focus-visible:ring-2 focus-visible:ring-accent-ring", "focus-visible:ring-focus")).toBe(
      "focus-visible:ring-2 focus-visible:ring-focus",
    );
    expect(cn("outline-accent", "outline-focus")).toBe("outline-focus");
  });

  it("never lets names of different kinds knock each other out", () => {
    const keep = [
      ["rounded-card", "shadow-card"],
      ["shadow-card", "bg-surface-1"],
      ["shadow-focus", "ring-focus"],
      ["ring-2", "ring-focus"],
      ["opacity-disabled", "duration-fast"],
      ["opacity-chart-dim", "bg-surface-raised-control"],
      ["duration-slow", "ease-out-quint"],
      ["text-ui", "text-fg-muted"],
      ["text-2xs", "text-accent-text"],
      ["bg-surface-inset", "border-border"],
      ["animate-shimmer", "duration-chart"],
    ];
    for (const classes of keep) expect(cn(...classes), classes.join(" ")).toBe(classes.join(" "));
  });

  it("treats every colour role as a colour", () => {
    const colours = scale("color");
    expect(colours).toEqual(expect.arrayContaining(["surface-raised-control", "surface-inset", "focus"]));
    for (const name of colours) {
      expect(cn(`bg-${name}`, "bg-transparent"), name).toBe("bg-transparent");
      // A text colour never replaces a text size, and the other way round.
      expect(cn("text-ui", `text-${name}`), name).toBe(`text-ui text-${name}`);
      expect(cn(`ring-${name}`, "ring-focus"), name).toBe("ring-focus");
    }
  });
});
