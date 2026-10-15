# Design

**Quiet luxury meets precision instrument.** Graphite surfaces, one brass accent, an editorial serif for headlines and tabular figures for every number. The data is the colour; the chrome stays out of the way.

## Tokens (`src/styles/tokens.css`)

Components use semantic tokens only (`bg-surface-1`, `text-fg-muted`, `border-border`, `var(--chart-1)`). Raw colours never appear in components. `globals.css` maps the tokens to Tailwind utilities in `@theme`.

| Role                              | Dark (default)                                | Light                                         |
| --------------------------------- | --------------------------------------------- | --------------------------------------------- |
| Background                        | `#0b0c0e`                                     | `#f7f6f2` (warm paper)                        |
| Surface                           | `#121418`                                     | `#ffffff`                                     |
| Text / muted / subtle             | `#edeef0` / `#9ba1a9` / `#7d838c`             | `#121417` / `#575d66` / `#61676f`             |
| Accent (brass / bronze)           | `#d6b47a`                                     | `#816226`                                     |
| Success / warning / danger / info | `#3fb68b` / `#e8833a` / `#f06a6d` / `#6c9ef8` | `#16774d` / `#a94e08` / `#b93127` / `#2f6fdb` |

Text contrast on the background is 16.9 / 7.5 / 5.1 in dark and 17.1 / 6.1 / 5.3 in light. Accent and status colours keep at least 4.5:1 even on their own tinted chips. The landing page and version log pass an automated WCAG 2.1 AA audit (axe-core) in both themes with no violations. Status colours are reserved for state, always shown with an icon or label, and never used for data series.

### Chart palettes

Categorical colours (fixed order, never cycled; a ninth series folds into "Others"):

| Slot  | 1         | 2         | 3         | 4         | 5         | 6         | 7         | 8         |
| ----- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- |
| Dark  | `#b98b3d` | `#3c79d1` | `#33a998` | `#7057ba` | `#317f38` | `#35a0cc` | `#bf5914` | `#934b98` |
| Light | `#ac7c26` | `#4a91f8` | `#008879` | `#9778f5` | `#1e7729` | `#299fcd` | `#c95b0a` | `#8c3f91` |

Both palettes were validated with an OKLab colour-vision-deficiency check (protan and deutan simulation). The worst adjacent-pair separation is ΔE 17.7 in dark and 18.0 in light, and every mark has at least 3:1 contrast against the chart surface. A sequential brass ramp (`--seq-1…8`) encodes magnitude, as in the state tile maps, and a blue ↔ neutral ↔ brass diverging scale (`--div-1…7`) encodes polarity.

## Type

- **Display**: Instrument Serif (self-hosted, `next/font/local`), used for headlines and the wordmark, with an italic for emphasis.
- **UI**: Geist Sans. Sizes: 11 px (`text-2xs`), 13 px (`text-ui`), 14–17 px body; display sizes 36 / 52 / 76 px.
- **Figures**: Geist Mono with tabular, slashed-zero figures (`font-figures`), so numbers align and don't jitter while counting up.

## Space, shape, depth and motion

- 4/8 px spacing grid. Radii: 10 px (controls), 14 px (cards), 20 px (panels).
- Three shadows (card, pop, lift), with a 1 px inner highlight in dark mode.
- Motion uses an out-quint ease (`cubic-bezier(0.22, 1, 0.36, 1)`), 200–400 ms for UI and up to about 1.3 s for chart drawing. Everything respects `prefers-reduced-motion` (Framer Motion `MotionConfig reducedMotion="user"` plus a CSS override).
- Atmosphere is restricted to the landing hero: a soft brass/blue mesh and fine film grain. No glassmorphism beyond the sticky headers.

## Charts

- Pick the form from the question: trend → line or area; ranked categories → sorted horizontal bars; composition → stacked bars or a donut with at most 6 slices; distribution → histogram; two measures → scatter with a trend line; weekday × hour → heatmap; states → tile map.
- **One axis.** Never a dual axis; the Pareto chart uses a single percentage axis.
- Bars start at zero, are at most 24 px thick and have 4 px rounded data ends. Lines are 2 px. Markers are at least 8 px with a 2 px surface ring. The grid is a solid hairline.
- Legends appear only for two or more series. Labels are selective: peak and low, never every point. Text uses text colours, never the series colour.
- Every chart has a table view, alt text, PNG/SVG/CSV export and a "Why this chart" note.
- An incomplete last period is faded, marked "partial" in its tooltip and explained in a note below the chart; on the landing preview it is drawn dashed. Top-N groups the rest into "Others", recomputed from the rows.

## Accessibility and responsiveness

- Keyboard reachable throughout: skip link, visible brass focus rings, Radix primitives for dialogs, menus, tabs and selects, keyboard resizing of dashboard cards, and Ctrl/⌘+K.
- Screen-reader text for figures that animate. Charts have alt text and a data-table twin.
- Layout from 360 px to 4K: the filter rail and inspector collapse into sheets on small screens, and the landing page and version log were checked at 390 px and 1440 px in both themes with no horizontal scrolling.

## Brand

The mark (`src/ui/brand/logo.tsx`) is a lens rim with a brass measuring arc and a focal point, reading as both a jeweller's loupe and a gauge. The wordmark sets "Loupe" in Instrument Serif next to it.
