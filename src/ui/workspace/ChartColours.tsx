"use client";

/**
 * "Chart colours": the panel where the user picks the colours every chart,
 * KPI sparkline, report and export uses. Three ways:
 * - Presets: ready palettes, each passing every readability check in both
 *   themes;
 * - Your colours: up to eight of the user's own (brand) colours, kept
 *   exactly; Loupe fills the remaining series with colours that go with them;
 * - From one colour: one colour turned into a gradient of its own shades,
 *   or into a set of matching colours, plus the gradient used by heatmaps,
 *   cohort grids and funnels.
 * A live preview (small charts in the chosen colours, in either theme) and
 * the readability check (ui/charts/palette/check.ts: colour-blind
 * separation, distinctness, lightness, vividness, contrast) update as the
 * user chooses; "Improve readability" moves the lightness of the user's own
 * colours, never their hues, and leaves series 1 (the lead brand colour)
 * exactly as given. Nothing is saved until Apply.
 *
 * Since version 52.4 the panel opens on the presets, every one of which
 * passes the readability checks; "Advanced" holds the user's own colours and
 * "From one colour", with the readability report.
 *
 * Version 52.0 made it more useful:
 * - "Show on dashboard" (on by default) paints the draft on the page behind
 *   the panel as the user chooses, with the scrim left clear so the colours
 *   are seen as they are; Cancel or closing puts the colours in use back
 *   (palette/preview.ts, painted by ChartThemeSync without saving);
 * - "Your colours" takes a brand's colours from a logo or brand-guide image,
 *   read in the browser only (palette/fromImage.ts), or from a list of codes
 *   pasted whole (hexesIn).
 * The choice is stored in settings and saved with the dashboard config.
 *
 * Opened from the dashboard toolbar (ChartColoursButton), Settings and the
 * command palette through useChartColoursPanel; mounted once by Workspace.
 * Closing it gives focus back to where it was opened from, or, when that was
 * Settings (which closes as this opens), to Settings' own opener: the Sheet
 * primitive follows the hand-over (useDialogFocus in ui/primitives/dialog.tsx).
 * Explanations are one short line with the full text behind hover, a long
 * press or the ⓘ (ui/primitives/reveal.tsx); the check results stay whole.
 */
import * as React from "react";
import { create } from "zustand";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  ImagePlus,
  Info,
  Loader2,
  Pipette,
  Plus,
  Sparkles,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import { useSettings } from "@/store/settings";
import { useThemeKey } from "@/ui/common/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Input } from "@/ui/primitives/input";
import { Segmented } from "@/ui/primitives/segmented";
import { Switch } from "@/ui/primitives/switch";
import { Sheet, SheetContent } from "@/ui/primitives/sheet";
import { Tooltip } from "@/ui/primitives/tooltip";
import { Brief } from "@/ui/primitives/reveal";
import { hexesIn, normaliseHex } from "@/ui/charts/palette/colour";
import { coloursFromImage } from "@/ui/charts/palette/fromImage";
import { useChartThemePreview } from "@/ui/charts/palette/preview";
import { checkPalette, type CheckState, type PaletteReport, type ThemeMode } from "@/ui/charts/palette/check";
import { improve, SLOTS } from "@/ui/charts/palette/generate";
import {
  PRESETS,
  resolveTheme,
  sameChoice,
  type ChartThemeChoice,
  type ResolvedTheme,
  type SingleStyle,
  type ThemeColours,
} from "@/ui/charts/palette/themes";

/** Open state of the panel, shared by everything that opens it. */
export const useChartColoursPanel = create<{ open: boolean; setOpen: (open: boolean) => void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** The app's light/dark theme as a palette mode. */
function useMode(): ThemeMode {
  return useThemeKey() === "light" ? "light" : "dark";
}

/** Button that opens the panel, showing the first colours of the theme in use. */
export function ChartColoursButton({
  className,
  label = "Colours",
  onOpen,
}: {
  className?: string;
  label?: string;
  /** Runs before the panel opens (e.g. closing the Settings sheet it sits in). */
  onOpen?: () => void;
}) {
  const choice = useSettings((s) => s.chartTheme);
  const setOpen = useChartColoursPanel((s) => s.setOpen);
  const mode = useMode();
  const theme = React.useMemo(() => resolveTheme(choice), [choice]);
  return (
    <Button
      variant="secondary"
      size="sm"
      className={className}
      onClick={() => {
        onOpen?.();
        setOpen(true);
      }}
    >
      <span className="flex -space-x-1" aria-hidden>
        {theme[mode].series.slice(0, 3).map((c, i) => (
          <span key={i} className="size-3 rounded-full ring-2 ring-surface-2" style={{ background: c }} />
        ))}
      </span>
      {label}
      {/* The name starts with the visible label (WCAG 2.5.3), then says which colours are in use. */}
      <span className="sr-only"> ({theme.name} chart colours)</span>
    </Button>
  );
}

/** The panel itself; its body mounts on open, so every opening starts from the colours in use. */
export function ChartColoursSheet() {
  const open = useChartColoursPanel((s) => s.open);
  const setOpen = useChartColoursPanel((s) => s.setOpen);
  // While the page shows the draft, the scrim stays clear: a dimmed chart would misjudge the colours.
  const live = useChartThemePreview((s) => s.live);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        title="Chart colours"
        description="Colours for every chart, report and export. Kept in this browser and saved with your dashboard."
        className="max-w-[min(680px,100vw)]"
        overlayClassName={live ? "bg-transparent" : undefined}
      >
        <Editor onClose={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

type Tab = "presets" | "custom" | "single";

/** Colours offered as a starting point in "From one colour": common brand hues. */
const SUGGESTED = [
  "#1d4ed8",
  "#0e7490",
  "#047857",
  "#4d7c0f",
  "#b45309",
  "#c2410c",
  "#be123c",
  "#a21caf",
  "#6d28d9",
  "#334155",
];

function Editor({ onClose }: { onClose: () => void }) {
  const current = useSettings((s) => s.chartTheme);
  const setChartTheme = useSettings((s) => s.setChartTheme);
  const appMode = useMode();
  // Every tab starts from the colours in use, so switching tabs never loses them.
  const [inUse] = React.useState(() => resolveTheme(current));
  const [tab, setTab] = React.useState<Tab>(current.kind === "preset" ? "presets" : current.kind);
  const [presetId, setPresetId] = React.useState(current.kind === "preset" ? current.id : "loupe");
  const [colours, setColours] = React.useState<string[]>(
    current.kind === "custom" ? current.colours : inUse.light.series.slice(0, 4),
  );
  const [single, setSingle] = React.useState<{ colour: string; style: SingleStyle }>(
    current.kind === "single"
      ? { colour: current.colour, style: current.style }
      : { colour: inUse.light.series[0] as string, style: "shades" },
  );
  const [mode, setMode] = React.useState<ThemeMode>(appMode);
  // The Advanced choice last used, so switching back from the presets returns to it.
  const [lastAdvanced, setLastAdvanced] = React.useState<Tab>(
    current.kind === "single" ? "single" : "custom",
  );

  const draft: ChartThemeChoice =
    tab === "presets"
      ? { kind: "preset", id: presetId }
      : tab === "custom"
        ? { kind: "custom", colours }
        : { kind: "single", colour: single.colour, style: single.style };
  // Generating a palette takes a few milliseconds; deferring it keeps a dragged colour picker smooth.
  const draftKey = React.useDeferredValue(JSON.stringify(draft));
  const resolved = React.useMemo(() => resolveTheme(JSON.parse(draftKey) as ChartThemeChoice), [draftKey]);
  const reports = React.useMemo(
    () => ({
      light: checkPalette(resolved.light.series, "light"),
      dark: checkPalette(resolved.dark.series, "dark"),
    }),
    [resolved],
  );
  const changed = !sameChoice(draft, current);
  const live = useChartThemePreview((s) => s.live);
  const setLive = useChartThemePreview((s) => s.setLive);
  // The page behind shows the draft as it is chosen; closing the panel, by Apply or not, clears it.
  React.useEffect(() => {
    useChartThemePreview.getState().setDraft(JSON.parse(draftKey) as ChartThemeChoice);
  }, [draftKey]);
  React.useEffect(() => () => useChartThemePreview.getState().setDraft(null), []);

  const apply = () => {
    const before = current;
    setChartTheme(draft);
    toast.success(`Chart colours: ${resolved.name}`, {
      description: "Every chart, report and export now uses them.",
      action: { label: "Undo", onClick: () => setChartTheme(before) },
    });
    onClose();
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="grid gap-6 px-6 py-5">
        {/* Presets first; the user's own colours and "From one colour" one click away, under Advanced. */}
        <Segmented<"presets" | "advanced">
          ariaLabel="How to choose colours"
          value={tab === "presets" ? "presets" : "advanced"}
          onChange={(v) => setTab(v === "presets" ? "presets" : lastAdvanced)}
          className="w-full [&>*]:flex-auto [&>*]:whitespace-nowrap"
          options={[
            { value: "presets", label: "Presets" },
            { value: "advanced", label: "Advanced" },
          ]}
        />
        {tab !== "presets" ? (
          <Segmented<Tab>
            ariaLabel="Your own colours"
            size="sm"
            value={tab}
            onChange={(v) => {
              setTab(v);
              setLastAdvanced(v);
            }}
            options={[
              { value: "custom", label: "Your colours" },
              { value: "single", label: "From one colour" },
            ]}
          />
        ) : null}
        {tab === "presets" ? (
          <PresetPicker value={presetId} onChange={setPresetId} mode={mode} inUse={current} />
        ) : tab === "custom" ? (
          <CustomColours colours={colours} onChange={setColours} theme={resolved} mode={mode} />
        ) : (
          <SingleColour value={single} onChange={setSingle} theme={resolved} mode={mode} />
        )}
        <section aria-labelledby="colours-preview" className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="colours-preview" className="text-sm font-medium text-fg">
              Preview
            </h3>
            <label className="ml-auto flex items-center gap-2 text-ui text-fg-muted">
              <Switch checked={live} onCheckedChange={setLive} />
              Show on dashboard
            </label>
            <Segmented<ThemeMode>
              ariaLabel="Preview theme"
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          </div>
          <Preview colours={resolved[mode]} mode={mode} />
        </section>
        {/* Every preset passes the checks; the report matters for colours of one's own. */}
        {tab !== "presets" ? (
          <Readability reports={reports} mode={mode} shades={tab === "single" && single.style === "shades"} />
        ) : null}
      </div>
      <div className="sticky bottom-0 mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-overlay px-6 py-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setTab("presets");
            setPresetId("loupe");
          }}
        >
          Use Loupe colours
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!changed} onClick={apply}>
            Apply colours
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- presets

function PresetPicker({
  value,
  onChange,
  mode,
  inUse,
}: {
  value: string;
  onChange: (id: string) => void;
  mode: ThemeMode;
  inUse: ChartThemeChoice;
}) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  // Arrow keys move the choice, as in any radio group.
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const step =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + PRESETS.length) % PRESETS.length;
    onChange((PRESETS[next] as (typeof PRESETS)[number]).id);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Preset palettes" className="grid gap-2 sm:grid-cols-2">
      {PRESETS.map((p, i) => {
        const on = p.id === value;
        const used = inUse.kind === "preset" && inUse.id === p.id;
        return (
          <button
            key={p.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(p.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              // No transition: arrow keys move the choice, and a keyboard action shows at once.
              "grid gap-2 rounded-card border p-3 text-left focus-visible:focus-ring",
              on
                ? "border-accent bg-surface-selected"
                : "border-border hover:border-border-hover hover:bg-surface-hover",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-ui font-medium text-fg">{p.name}</span>
              {used ? <Badge tone="accent">In use</Badge> : p.id === "loupe" ? <Badge>Default</Badge> : null}
            </span>
            <span className="line-clamp-2 text-xs leading-relaxed text-fg-muted" title={p.description}>
              {p.description}
            </span>
            <SwatchStrip colours={p[mode]} />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- your colours

function CustomColours({
  colours,
  onChange,
  theme,
  mode,
}: {
  colours: string[];
  onChange: (colours: string[]) => void;
  theme: ResolvedTheme;
  mode: ThemeMode;
}) {
  const filled = theme.light.series.slice(theme.given);
  const tidy = () => {
    const before = colours.map((c) => normaliseHex(c) ?? c);
    // Series 1 is usually the lead brand colour: it stays exactly as given, the others make room for it.
    const after = improve(before, "light", { keep: 1 });
    const moved = after.flatMap((c, i) => (c !== before[i] ? [i + 1] : []));
    if (!moved.length) {
      toast("Your colours are already as readable as their hues allow.");
      return;
    }
    onChange(after);
    toast.success(
      `Adjusted the lightness of series ${moved.join(", ")}; every hue, and your series 1 colour, is unchanged.`,
      { action: { label: "Undo", onClick: () => onChange(before) } },
    );
  };
  return (
    <section aria-labelledby="your-colours" className="grid gap-3">
      <div>
        <h3 id="your-colours" className="text-sm font-medium text-fg">
          Your colours, in series order
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
          <Brief
            label="About your colours"
            full={`Type or pick up to ${SLOTS} colours, say from your brand guide. They are used exactly as given in the light theme; in the dark theme the same hues are adjusted in lightness so they stay readable.`}
          >
            Up to {SLOTS}, used exactly as given.
          </Brief>
        </p>
      </div>
      <ol className="grid gap-2">
        {colours.map((c, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-fg-subtle">Series {i + 1}</span>
            <ColourField
              value={normaliseHex(c) ?? "#000000"}
              onChange={(v) => onChange(colours.map((x, j) => (j === i ? v : x)))}
              label={`Series ${i + 1} colour`}
            />
            {colours.length > 1 ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove series ${i + 1} colour`}
                onClick={() => onChange(colours.filter((_, j) => j !== i))}
              >
                <X aria-hidden />
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {colours.length < SLOTS ? (
          <Button
            variant="outline"
            size="sm"
            // A new series starts from the colour Loupe would have filled in, ready to change.
            onClick={() => onChange([...colours, theme.light.series[colours.length] as string])}
          >
            <Plus aria-hidden /> Add a colour
          </Button>
        ) : null}
        <Button variant="secondary" size="sm" onClick={tidy}>
          <Wand2 aria-hidden /> Improve readability
        </Button>
      </div>
      <BrandSources colours={colours} onChange={onChange} />
      {filled.length ? (
        <div className="grid gap-1.5 rounded-control border border-border px-3 py-2.5">
          <p className="text-xs leading-relaxed text-fg-muted">
            <Brief
              label="About the colours Loupe added"
              full={`${filled.length === 1 ? `Series ${SLOTS}` : `Series ${theme.given + 1}–${SLOTS}`} use matching colours Loupe picked to go with yours and stay distinct.`}
            >
              {filled.length === 1 ? `Series ${SLOTS}` : `Series ${theme.given + 1}–${SLOTS}`}: matched by
              Loupe
            </Brief>
          </p>
          <SwatchStrip colours={theme[mode].series.slice(theme.given)} start={theme.given} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * Two quicker ways to a brand's colours: its logo or a page of its brand guide (an image read in the
 * browser, never sent), or a list of codes pasted whole. Either replaces the list, with an Undo.
 */
function BrandSources({ colours, onChange }: { colours: string[]; onChange: (colours: string[]) => void }) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [reading, setReading] = React.useState(false);
  const [pasted, setPasted] = React.useState("");
  const take = (found: string[], from: string, order: string) => {
    const before = colours;
    const next = found.slice(0, SLOTS);
    onChange(next);
    toast.success(`${next.length} colour${next.length === 1 ? "" : "s"} from ${from}`, {
      description: order,
      action: { label: "Undo", onClick: () => onChange(before) },
    });
  };
  const fromImage = async (file: File) => {
    setReading(true);
    try {
      const found = await coloursFromImage(file, SLOTS);
      if (found.length) take(found, file.name, "Most used first, so series 1 is the main one.");
      else toast("No colours found in that image apart from white, black and grey.");
    } catch {
      toast.error("That image couldn't be read. Try a PNG, JPEG or SVG.");
    } finally {
      setReading(false);
    }
  };
  const paste = () => {
    const found = hexesIn(pasted);
    if (!found.length) {
      toast("No colour codes found. Paste codes such as #1D4ED8.");
      return;
    }
    take(found, "your list", "In the order you listed them.");
    setPasted("");
  };
  return (
    <div className="grid gap-2 rounded-control border border-border px-3 py-3">
      <p className="text-xs text-fg-muted">
        <Brief
          label="About brand colours"
          full="Pick your logo or a page of your brand guide and Loupe takes its main colours, most used first, leaving out white, black and grey. The image is read in this browser and never sent anywhere. Or paste a list of colour codes, in any format that has them, such as “Navy #1D4ED8, Gold #F59E0B”."
        >
          Or take them from your logo, or paste a list.
        </Brief>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void fromImage(file);
          }}
        />
        <Button variant="outline" size="sm" disabled={reading} onClick={() => fileRef.current?.click()}>
          {reading ? <Loader2 className="animate-spin" aria-hidden /> : <ImagePlus aria-hidden />} From a logo
          or image
        </Button>
        <form
          className="flex min-w-0 flex-[1_1_220px] items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            paste();
          }}
        >
          <Input
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste codes: #1D4ED8 #F59E0B"
            aria-label="Paste colour codes"
            spellCheck={false}
            className="font-data min-w-0 flex-1"
          />
          <Button type="submit" variant="secondary" size="sm" disabled={!pasted.trim()}>
            <ClipboardPaste aria-hidden /> Use
          </Button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- from one colour

function SingleColour({
  value,
  onChange,
  theme,
  mode,
}: {
  value: { colour: string; style: SingleStyle };
  onChange: (v: { colour: string; style: SingleStyle }) => void;
  theme: ResolvedTheme;
  mode: ThemeMode;
}) {
  return (
    <section aria-labelledby="one-colour" className="grid gap-4">
      <div>
        <h3 id="one-colour" className="text-sm font-medium text-fg">
          Your colour
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
          <Brief
            label="About one colour"
            full="Pick one colour and Loupe designs the rest: its gradient for heatmaps and funnels, and the series colours in the style you choose."
          >
            Pick one colour; Loupe designs the rest.
          </Brief>
        </p>
      </div>
      <ColourField
        value={normaliseHex(value.colour) ?? "#000000"}
        onChange={(colour) => onChange({ ...value, colour })}
        label="Your colour"
        large
      />
      <div className="grid gap-1.5">
        <span className="text-xs text-fg-subtle">Or start from</span>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ ...value, colour: c })}
              aria-label={`Use ${c}`}
              aria-pressed={value.colour === c}
              className={cn(
                "size-7 rounded-full border-2 transition-transform duration-fast hover:scale-110 focus-visible:focus-ring",
                // The unselected ring is the panel's own colour, so only the chosen swatch shows one.
                value.colour === c ? "border-fg" : "border-surface-overlay",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <Segmented<SingleStyle>
          ariaLabel="Series colours"
          value={value.style}
          onChange={(style) => onChange({ ...value, style })}
          options={[
            { value: "shades", label: "Shades (gradient)" },
            { value: "matching", label: "Matching colours" },
          ]}
        />
        <p className="text-xs leading-relaxed text-fg-muted">
          <Brief
            label="About this style"
            full={
              value.style === "shades"
                ? "Every series is a lighter or darker shade of your colour, ordered so neighbouring series stay far apart. Best when charts show up to four series."
                : "Your colour leads; the other series are hues chosen to go with it and stay distinct, even for colour-blind viewers."
            }
          >
            {value.style === "shades"
              ? "Shades of your colour; best up to four series."
              : "Your colour leads; matching hues follow."}
          </Brief>
        </p>
      </div>
      <div className="grid gap-2 rounded-control border border-border px-3 py-2.5">
        <span className="text-xs text-fg-muted">Series colours</span>
        <SwatchStrip colours={theme[mode].series} />
        <span className="mt-1 text-xs text-fg-muted">Gradient, low to high</span>
        <RampStrip colours={theme[mode].ramp} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- shared pieces

/** The EyeDropper API (Chrome and Edge): picks any colour on screen, even outside the browser. */
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
const eyeDropper = (): EyeDropperCtor | null =>
  typeof window !== "undefined" && "EyeDropper" in window
    ? (window as unknown as { EyeDropper: EyeDropperCtor }).EyeDropper
    : null;

/**
 * A colour as a swatch (the browser's colour picker), a hex code field and,
 * where the browser has one, a "pick from screen" eyedropper, so a colour
 * can come straight from a logo or brand guide open anywhere on screen. The
 * field commits a valid code as it is typed; an invalid one stays in the
 * field, marked, until it is fixed.
 */
function ColourField({
  value,
  onChange,
  label,
  large = false,
}: {
  value: string;
  onChange: (hex: string) => void;
  label: string;
  large?: boolean;
}) {
  // What the user typed, tied to the value it was typed against: a new value from the picker replaces it.
  const [typed, setTyped] = React.useState({ text: value, base: value });
  const text = typed.base === value ? typed.text : value;
  const valid = normaliseHex(text) !== null;
  const Dropper = eyeDropper();
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label}: pick`}
        className={cn(
          "shrink-0 cursor-pointer rounded-control border border-border-strong bg-surface-2 p-0.5 transition-colors hover:border-border-hover focus-visible:focus-ring [&::-moz-color-swatch]:rounded-sm [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0",
          large ? "h-12 w-16" : "h-9 w-12",
        )}
      />
      <Input
        value={text}
        onChange={(e) => {
          setTyped({ text: e.target.value, base: value });
          const hex = normaliseHex(e.target.value);
          if (hex) onChange(hex);
        }}
        aria-label={`${label}: hex code`}
        aria-invalid={!valid}
        spellCheck={false}
        maxLength={9}
        className={cn("font-data w-32 uppercase", !valid && "border-danger focus-visible:border-danger")}
      />
      {Dropper ? (
        <Tooltip content="Pick a colour from anywhere on your screen, such as your logo">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${label}: pick from screen`}
            onClick={async () => {
              try {
                const hex = normaliseHex((await new Dropper().open()).sRGBHex);
                if (hex) onChange(hex);
              } catch {
                /* the user pressed Escape: nothing picked */
              }
            }}
          >
            <Pipette aria-hidden />
          </Button>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** Series colours as numbered swatches (numbers continue from `start`). */
function SwatchStrip({ colours, start = 0 }: { colours: string[]; start?: number }) {
  return (
    <span className="flex flex-wrap gap-1" role="img" aria-label={`Series colours: ${colours.join(", ")}`}>
      {colours.map((c, i) => (
        <span
          key={i}
          className="h-5 w-7 rounded-xs ring-1 ring-border ring-inset"
          style={{ background: c }}
          title={`Series ${start + i + 1}: ${c}`}
        />
      ))}
    </span>
  );
}

function RampStrip({ colours }: { colours: string[] }) {
  return (
    <span
      className="flex overflow-hidden rounded-xs"
      role="img"
      aria-label={`Gradient: ${colours.join(", ")}`}
    >
      {colours.map((c, i) => (
        <span key={i} className="h-4 flex-1" style={{ background: c }} title={c} />
      ))}
    </span>
  );
}

/** Small charts in the chosen colours, drawn on the chosen theme's background. */
function Preview({ colours, mode }: { colours: ThemeColours; mode: ThemeMode }) {
  const s = colours.series;
  const r = colours.ramp;
  const gap = "var(--surface-1)";
  const card = (title: string, label: string, body: React.ReactNode) => (
    <figure className="grid gap-1.5 rounded-control border border-border p-2.5">
      <svg viewBox="0 0 120 64" className="h-16 w-full" role="img" aria-label={label}>
        {body}
      </svg>
      <figcaption className="text-xs text-fg-subtle">{title}</figcaption>
    </figure>
  );
  const bars = [0.45, 0.7, 0.55, 0.9, 0.62, 0.8];
  const stacks = [
    [0.3, 0.2, 0.15, 0.1],
    [0.25, 0.25, 0.2, 0.12],
    [0.35, 0.15, 0.2, 0.15],
    [0.28, 0.22, 0.12, 0.2],
  ];
  const lines = [
    [0.3, 0.42, 0.38, 0.55, 0.5, 0.68, 0.74],
    [0.55, 0.5, 0.6, 0.52, 0.64, 0.6, 0.66],
    [0.8, 0.72, 0.76, 0.7, 0.66, 0.7, 0.62],
  ];
  const slices = [0.3, 0.22, 0.16, 0.13, 0.11, 0.08];
  let angle = -Math.PI / 2;
  const arcs = slices.map((v) => {
    const a0 = angle;
    angle += v * 2 * Math.PI;
    return [a0, angle] as const;
  });
  const arc = (a0: number, a1: number) => {
    const R = 26;
    const x0 = 60 + R * Math.cos(a0);
    const y0 = 32 + R * Math.sin(a0);
    const x1 = 60 + R * Math.cos(a1);
    const y1 = 32 + R * Math.sin(a1);
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  };
  return (
    // A chart container, so it keeps --surface-1 inside the sheet: the palettes are validated against
    // it (every mark at least 3:1). Everything else in an overlay sits on the overlay plane.
    <div
      data-theme={mode}
      className="grid grid-cols-2 gap-2.5 rounded-card border border-border bg-surface-1 p-3 sm:grid-cols-3"
    >
      {card(
        "One series",
        "Bar chart in series 1",
        <>
          {bars.map((v, i) => (
            <rect key={i} x={8 + i * 18} y={58 - v * 52} width={12} height={v * 52} rx={2} fill={s[0]} />
          ))}
          <line x1={4} x2={116} y1={58.5} y2={58.5} stroke="var(--chart-axis)" />
        </>,
      )}
      {card(
        "Stacked",
        "Stacked bars in series 1 to 4",
        stacks.map((col, i) => {
          let y = 58;
          return col.map((v, k) => {
            const h = v * 70;
            y -= h;
            return (
              <rect
                key={`${i}-${k}`}
                x={10 + i * 27}
                y={y}
                width={20}
                height={h}
                fill={s[k]}
                stroke={gap}
                strokeWidth={1.5}
              />
            );
          });
        }),
      )}
      {card(
        "Lines",
        "Line chart in series 1 to 3",
        lines.map((ln, k) => (
          <polyline
            key={k}
            points={ln.map((v, i) => `${6 + i * 18},${60 - v * 56}`).join(" ")}
            fill="none"
            stroke={s[k]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )),
      )}
      {card(
        "Share",
        "Donut in series 1 to 6",
        <>
          {arcs.map(([a0, a1], i) => (
            <path key={i} d={arc(a0, a1)} fill="none" stroke={s[i]} strokeWidth={11} />
          ))}
          {arcs.map(([a0], i) => (
            <line
              key={`g${i}`}
              x1={60 + 19 * Math.cos(a0)}
              y1={32 + 19 * Math.sin(a0)}
              x2={60 + 33 * Math.cos(a0)}
              y2={32 + 33 * Math.sin(a0)}
              stroke={gap}
              strokeWidth={1.5}
            />
          ))}
        </>,
      )}
      {card(
        "Gradient",
        "Heatmap on the gradient",
        Array.from({ length: 4 }, (_, row) =>
          Array.from({ length: 7 }, (_, col) => (
            <rect
              key={`${row}-${col}`}
              x={4 + col * 16.4}
              y={4 + row * 14.4}
              width={15}
              height={13}
              rx={2}
              fill={r[1 + ((col * 3 + row * 5 + ((col * row) % 4)) % 7)]}
            />
          )),
        ),
      )}
      {card(
        `All ${SLOTS} series`,
        "Every series colour in order",
        s.map((c, i) => (
          <g key={i}>
            <rect x={4 + (i % 4) * 28.5} y={i < 4 ? 6 : 36} width={25} height={22} rx={3} fill={c} />
          </g>
        )),
      )}
    </div>
  );
}

const STATE_ICON: Record<CheckState, typeof CheckCircle2> = {
  pass: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
};
const STATE_TEXT: Record<CheckState, string> = {
  pass: "text-success",
  warn: "text-warning",
  fail: "text-danger",
};

function summary(r: PaletteReport): { tone: "success" | "warning" | "danger"; text: string } {
  const issues = r.checks.filter((c) => c.state !== "pass").length;
  if (r.state === "pass") return { tone: "success", text: "passes every check" };
  return {
    tone: r.state === "fail" ? "danger" : "warning",
    text: `${issues} ${issues === 1 ? "thing" : "things"} to look at`,
  };
}

/** The readability check for the previewed theme, with a one-line verdict for both. */
function Readability({
  reports,
  mode,
  shades,
}: {
  reports: Record<ThemeMode, PaletteReport>;
  mode: ThemeMode;
  shades: boolean;
}) {
  return (
    <section aria-labelledby="colours-check" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="colours-check" className="text-sm font-medium text-fg">
          Readability
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {(["light", "dark"] as const).map((m) => {
            const s = summary(reports[m]);
            return (
              <Badge key={m} tone={s.tone}>
                {m === "light" ? "Light" : "Dark"}: {s.text}
              </Badge>
            );
          })}
        </div>
      </div>
      <ul className="grid gap-2" aria-label={`Checks for the ${mode} theme`}>
        {reports[mode].checks.map((c) => {
          const Icon = STATE_ICON[c.state];
          return (
            <li key={c.id} className="flex items-start gap-2 text-ui leading-relaxed text-fg-muted">
              <Icon className={cn("mt-0.5 size-4 shrink-0", STATE_TEXT[c.state])} aria-label={c.state} />
              <span>{c.message}</span>
            </li>
          );
        })}
      </ul>
      {shades ? (
        <p className="flex items-start gap-2 rounded-control border border-border px-3 py-2 text-xs leading-relaxed text-fg-muted">
          <Info className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
          <Brief
            label="About shades"
            full="Shades of one colour can only be so far apart: they read best on charts with up to four series. For more, choose “Matching colours”."
          >
            Shades read best with up to four series.
          </Brief>
        </p>
      ) : null}
      <p className="flex items-start gap-2 text-xs leading-relaxed text-fg-subtle">
        <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <Brief
          label="How the colours are checked"
          full={`Checked the way Loupe's own palette was: neighbouring series under simulated colour blindness (protanopia and deuteranopia), with normal vision, and against the ${mode} background.`}
        >
          Checked for colour blindness and contrast.
        </Brief>
      </p>
    </section>
  );
}
