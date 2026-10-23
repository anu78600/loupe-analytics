# Design

**A modern analytics studio.** Cool slate surfaces, one indigo accent, a single sans voice (Inter: semibold at its display optical size for headlines, regular for everything else) and tabular figures for every number. The data is the colour; the chrome stays out of the way. Version 50.0 moved the identity here from warm paper, brass and an editorial serif; it is stage 1 of the five-stage redesign listed under Planned on the version log.

## Tokens: two themes, each designed on its own

Colour is built in three tiers, the way Figma variables, GitHub Primer and Vercel's Geist are:

1. **Primitives** (`src/styles/primitives.css`). Raw ramps of 12 steps per family, named `--base-{family}-{step}`, generated in OKLCH and written as hex. The families are a cool neutral (slate), the indigo accent (iris), blue, green, red and amber. Light and dark have separate ramps (`-dark-`), because a dark theme is designed, not inverted. Steps keep Radix's meaning: 1–2 backgrounds, 3–5 interactive fills, 6–8 borders, 9–10 solids, 11–12 text. Components never use primitives.
2. **Semantic roles**, one file per theme: `src/styles/theme-light.css` and `src/styles/theme-dark.css`. Both have the same names, with values chosen for that theme:
   - surfaces: `--bg`, `--bg-subtle` (sunken), `--surface-1…3`, `--surface-overlay`, the hover, active and selected states, and two for controls: `--surface-raised-control` (a raised key: the segmented control's choice, the secondary button) and `--surface-inset` (the well a key sits in, the segmented track);
   - text: `--fg`, `--fg-muted`, `--fg-subtle`, `--fg-disabled`;
   - borders: `--border-subtle`, `--border`, `--border-strong`, `--border-hover`;
   - accent: `--accent`, hover, active, `--accent-text`, `--accent-soft`, `--focus`;
   - status: base, `-text`, `-soft` and `-border` for success, warning, danger and info;
   - charts and shadows.
3. **Utilities** (`src/app/globals.css` `@theme`). These map the roles onto Tailwind names (`bg-surface-overlay`, `text-fg-muted`, `ring-focus`). `src/styles/tokens.css` is only the entry point that imports the three files.

**Light theme.** Bright, crisp, a hairline:

| Element                          | Treatment                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Canvas                           | Cool off-white `#f5f6f8`                                                                                                 |
| Sunken areas (wells, side areas) | `#eef0f2`                                                                                                                |
| Raised cards                     | White, with a hairline ring and a soft two-layer shadow                                                                  |
| Overlays                         | White, with a deeper layered shadow                                                                                      |
| Text                             | Blue-black `#14171e`, muted `#484c55`, subtle `#636770`, kept at least 7 OKLCH L apart so the three levels read as three |
| Accent                           | Indigo `#504bdd` carrying white text, with a darker `--accent-text` for words                                            |
| States                           | The ink at 6 % on hover and 10 % pressed; selected is the indigo at 10 %, a step stronger and tinted                     |
| Controls                         | A raised key in white; its track the ink at 6.5 %, a well about 4 L below whatever plane holds it                        |
| Focus                            | Solid ring with a 2 px gap                                                                                               |

**Dark theme.** Depth by light, not by shadow:

| Element       | Treatment                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Canvas        | Blue-black `#0b0c10`, never pure black                                                                                          |
| Sunken areas  | `#060709`                                                                                                                       |
| Raised levels | Each one lighter: surface 1–3 `#111318`, `#171a1f`, `#1e2026`                                                                   |
| Overlays      | The lightest plane, `#25282e`, so menus and popovers clearly sit above the page                                                 |
| Raised edges  | A white inset top highlight (5–7%) over deeper shadows                                                                          |
| Borders       | White at 6–20%                                                                                                                  |
| Text          | Never pure white: `#edeff3`, `#bbbec5`, `#9b9fa7`, balanced by APCA as well as WCAG, because WCAG 2 overstates contrast on dark |
| Accent        | Periwinkle `#8995f4` carrying dark ink, light enough to read as text on its own tint; accent text lighter and calmer still      |
| Status tints  | Very dark, low-chroma                                                                                                           |
| Controls      | Relative to their plane: a raised key a 6 % white step above it, its track a 25 % black step into it                            |

**Inside overlays.** A dialog, sheet, popover or menu is the top plane, so nothing inside it rises above it. Cards and groups inside one (the Settings groups, the dataset card in the phone's Filters sheet, the list in a question) sit on the overlay plane with their border alone: no fill and no card shadow. A darker fill there reads as a hole, and in dark a lighter one would be a plane the system doesn't have. Controls keep their own surfaces (a field its fill, a segmented track its well, a button its key); code keeps its well (`--bg-subtle`, which the code colours are checked against); and a chart keeps `--surface-1`, the surface its palettes are validated against. A part shown both on the page and in a sheet says which it is in (`FilterRail`'s `inSheet`).

**Shared scales:**

| Scale      | Values                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Radius     | 4 / 6 / 8 (controls) / 12 (cards) / 16 (panels); an inner radius is the outer minus the padding |
| Motion     | 120 / 180 / 240 ms for the interface, with chart drawing timed separately                       |
| Disabled   | One opacity                                                                                     |
| Focus ring | `0 0 0 2px var(--bg), 0 0 0 4px var(--focus)`                                                   |

**Proof.** `tests/theme-contrast.test.ts` reads both themes and fails if any of these slips:

| Check                                 | Requirement                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| Text on every surface                 | ≥ 12:1 / Lc 90 (primary), ≥ 7:1 / Lc 60 (muted), ≥ 4.5:1 / Lc 45 (subtle)                |
| Focus ring                            | ≥ 3:1                                                                                    |
| Accent and status text on their tints | ≥ 4.5:1                                                                                  |
| Hover, pressed and selected           | Each visible on every plane (≥ 3 L), stronger in that order; text stays readable on them |
| Controls                              | The track below its plane, the key ≥ 4 L out of it, labels ≥ 7:1                         |
| Dark surfaces                         | Get lighter at each level                                                                |
| Low end of the sequential ramps       | Visible against cards                                                                    |

### Chart palettes

Categorical colours (fixed order, never cycled; a ninth series folds into "Others"):

| Slot  | 1         | 2         | 3         | 4         | 5         | 6         | 7         | 8         |
| ----- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- |
| Dark  | `#5a5be1` | `#d06107` | `#9d48ea` | `#d31c71` | `#008dc7` | `#358203` | `#27a598` | `#a77800` |
| Light | `#5b5ce2` | `#e57429` | `#a855f7` | `#db2777` | `#009dde` | `#348100` | `#27a497` | `#b8860b` |

Both palettes were validated with an OKLab colour-vision-deficiency check (protan and deutan simulation). The worst adjacent-pair separation is ΔE 14.1 in dark and 14.0 in light, and every mark has at least 3:1 contrast against the chart surface. A sequential brass ramp (`--seq-1…8`) encodes magnitude, as in the state tile maps, and a blue ↔ neutral ↔ brass diverging scale (`--div-1…7`) encodes polarity.

## Type

Three families, one job each. All are self-hosted under the SIL Open Font Licence: the files are in `src/app/fonts` (web) and `public/fonts` (PDFs and the social image), with their licences. No font host is contacted.

- **Inter** (`font-sans`, the default) is used for every word of the interface and every figure.
  - It is the variable font with optical sizes: small text gets the open text cut and headings the tighter display cut, without a second family.
  - It is cut into two files. The Latin file is preloaded. The extended file (Central European, Vietnamese, Greek) has its own `unicode-range`, so it downloads only for a page that shows one of those characters. `scripts/subset-fonts.py` rebuilds both from the Inter release.
  - The defaults stay on, and they do real work: contextual alternates centre a colon between digits (10:30) and a hyphen between capitals.
- **Display** (`font-display`) is Inter again, semibold, with the optical-size axis following the size, so headings get Inter's tighter display cut. It sets page and section headings of 26 px and up, always through a `display-*` size, and the wordmark. Emphasis inside a heading is colour (`text-gradient-accent`), never a slant: Inter ships no italic.
- **Geist Mono** (`font-mono`) is for code only: SQL, DAX, TMDL and the AI request's payload. It isn't preloaded.

**Figures** are Inter with tabular numerals.

- `font-figures` is for KPI values and anything that counts up. `tabular` is for numbers in running text and tables.
- A column of values lines up digit for digit, and a counting value doesn't jitter. A monospace is never used for numbers, because it made them read like code.
- `font-data` sets the user's own values in the data grid, samples and table views. It turns off ligatures (Inter would draw `->` as an arrow) and turns on Inter's disambiguation set, so "Il1" can't be misread.

**The scale** (globals.css `@theme`). Each size carries its line height and its tracking: slightly open at 11 px, tighter as sizes grow.

| Class                    | Size / line | Use                                                               |
| ------------------------ | ----------- | ----------------------------------------------------------------- |
| `text-2xs`               | 11 / 16     | Uppercase labels (the `eyebrow` utility), counters, keyboard keys |
| `text-xs`                | 12 / 18     | Captions, hints, meta lines, table headers, chips                 |
| `text-ui`                | 13 / 20     | Controls: buttons, inputs, menus, tabs, dense rows                |
| `text-sm`                | 14 / 22     | Body copy in the app                                              |
| `text-md`                | 15 / 24     | Card titles and lead lines                                        |
| `text-base`              | 16 / 26     | Reading text on the landing page, glossary and version log        |
| `text-lg` … `text-5xl`   | 18 – 48     | Sans titles and figures                                           |
| `text-display-xs` … `xl` | 26 – 80     | Display headings: 26, 32, 40, 48, 60 and 80 px                    |

Rules:

- No text is smaller than 11 px, and no sentence is smaller than 12 px.
- One uppercase label style everywhere: `eyebrow` (11 px, weight 600, 0.08em tracking, case-sensitive forms).
- Weights: 400 for body text, 500 for labels and controls, 600 for sans headings and hero figures.
- Chart text is Inter at 11 px or more; value labels and value axes use the figures face (`ui/charts/tokens.ts`).
- The text PDFs embed Inter, with Geist Mono for their code blocks. The social image sets its headline in Inter SemiBold and its facts in Inter.
- Only the fixed-size export canvases (the report pages and the 1920 × 1080 slides) size text in pixels.
- `tests/typography.test.ts` enforces these rules:
  - no hand-picked sizes or letter-spacing;
  - the display face only at display sizes, and monospace only in code views;
  - a 11 px floor on chart text;
  - the font files and their character ranges match the layout.

## Space, shape, depth and motion

- 4/8 px spacing grid. Radii come from the scale:

  | Name      | Size  | Used for |
  | --------- | ----- | -------- |
  | `xs`      | 4 px  |          |
  | `sm`      | 6 px  |          |
  | `control` | 8 px  | Controls |
  | `card`    | 12 px | Cards    |
  | `panel`   | 16 px | Panels   |

  Inner corners nest: an inner radius is the outer radius minus the padding.

- Three shadows (card, pop, lift), each designed per theme. Light uses a hairline ring and soft layered shadows. Dark uses deeper shadows with a white inset top highlight.
- Motion uses an out-quint ease (`cubic-bezier(0.22, 1, 0.36, 1)`): `duration-fast` 120 ms, `base` 180 ms and `slow` 240 ms for the interface. Charts take up to about 1.3 s to draw. Keyboard choices and frequent actions don't animate. Everything respects `prefers-reduced-motion` (Framer Motion `MotionConfig reducedMotion="user"` plus a CSS override).
- Atmosphere is restricted to the landing hero: a soft indigo/sky mesh (the film grain is off). No glassmorphism beyond the sticky headers.

## App shell

The workspace (version 50.1, `src/ui/workspace/shell`) groups its eight steps into four phases: **Prepare** (Upload, Detect, Check & map), **Build** (Customise, Dashboard), **Analyse** (Questions & SQL, Insights) and **Share** (Export).

- **From 1024 px, a sidebar** lists the steps under their phases, with how far through you are, and the glossary and version log at its foot. It is the full list (240 px) from 1280 px, and an icon rail (64 px, names in tooltips) below that and on the canvas steps, Customise and Dashboard, where the charts need the width. Its toggle overrides both, and the choice is remembered (`html[data-sidebar]`, restored before first paint).
- **The top bar** is 56 px, sticky, over the content: the file, then the phase and the step as a breadcrumb, then search (Ctrl/⌘+K, the command palette), start over, settings and the theme.
- **Below 1024 px** there is no sidebar. The top bar shows the phase over the step, with a second row of the current phase's steps, and a bottom bar holds the four phases within the thumb's reach. A phase opens where you last were in it. The content and the toasts clear the bottom bar and the home indicator.
- A step that can't be opened yet (no data, no industry) stays visible and focusable, dimmed, and says why.

## Charts

- Pick the form from the question: trend → line or area; ranked categories → sorted horizontal bars; composition → stacked bars or a donut with at most 6 slices; distribution → histogram; two measures → scatter with a trend line; weekday × hour → heatmap; states → tile map.
- **One axis.** Never a dual axis; the Pareto chart uses a single percentage axis.
- Bars start at zero, are at most 24 px thick and have 4 px rounded data ends. Lines are 2 px. Markers are at least 8 px with a 2 px surface ring. The grid is a solid hairline.
- Legends appear only for two or more series. Labels are selective: peak and low, never every point. Text uses text colours, never the series colour.
- Every chart has a table view, alt text, PNG/SVG/CSV export and a "Why this chart" note.
- An incomplete last period is faded, marked "partial" in its tooltip and explained in a note below the chart; on the landing preview it is drawn dashed. Top-N groups the rest into "Others", recomputed from the rows.

## Accessibility and responsiveness

- Keyboard reachable throughout: skip link, visible indigo focus rings, Radix primitives for dialogs, menus, tabs and selects, keyboard resizing of dashboard cards, and Ctrl/⌘+K.
- Screen-reader text for figures that animate. Charts have alt text and a data-table twin.
- Layout from 360 px to 4K: the filter rail and inspector collapse into sheets on small screens, and the landing page and version log were checked at 390 px and 1440 px in both themes with no horizontal scrolling.

## Brand

The mark (`src/ui/brand/logo.tsx`) is a lens rim with an accent measuring arc and a focal point, reading as both a jeweller's loupe and a gauge. The wordmark sets "Loupe" in Inter SemiBold next to it. The files in `public/brand` and `src/app/icon.svg` are written by `scripts/brand-wordmark.py`.
