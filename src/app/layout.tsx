/**
 * Root layout for every route. Loads the three type families of the type
 * system (globals.css, docs/DESIGN.md): Inter for the interface, body copy and
 * figures; Instrument Serif for display headings and the wordmark; Geist Mono
 * for code only (SQL, DAX). Sets metadata, and runs themeBootScript in <head>
 * so the saved theme is applied before React hydrates (no light/dark flash).
 * Also renders the skip link and the client Providers (motion config,
 * tooltips, theme sync, toasts).
 *
 * Inter is self-hosted (the privacy rule allows no font CDN) as two subsets
 * of the variable font, each keeping the optical-size axis (opsz 14–32, so
 * headings get the tighter display cut and small text the open text cut) and
 * weights 400–700. The Latin file covers the interface and English text and
 * is preloaded; the extended file (Central European, Vietnamese, Greek)
 * downloads only when a page shows one of its characters, which the
 * unicode-range tells the browser without fetching it. Geist Mono and the
 * extended Inter file aren't preloaded, so a page fetches only the faces it
 * draws.
 *
 * The social tags carry no title or description of their own: Next fills
 * og:title, og:description and Twitter's from each page's own metadata, so a
 * shared link to the version log or the workspace names that page. The image
 * is opengraph-image.tsx; the icons are icon.svg, favicon.ico and
 * apple-icon.tsx in this folder.
 */
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "@/ui/common/providers";
import { themeBootScript } from "@/store/settings";
import { chartThemeBootScript } from "@/ui/charts/palette/apply";
import { AUTHOR } from "@/content/credits";
import "./globals.css";

// next/font reads its options at build time, so they must be literals. The unicode-range values are
// the ranges scripts/subset-fonts.py cuts the two files to (tests/typography.test.ts compares them).
const inter = localFont({
  src: "./fonts/Inter-Latin.woff2",
  weight: "400 700",
  variable: "--font-inter",
  display: "swap",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0394, U+03A3, U+03A9, U+03BB, U+03BC, U+03C0, U+03C3, U+2000-206F, U+2070-209F, U+20A0-20CF, U+2122, U+2150-218F, U+2190-21FF, U+2200-22FF, U+2300-23FF, U+25A0-25FF, U+FEFF, U+FFFD",
    },
  ],
});

const interExt = localFont({
  src: "./fonts/Inter-LatinExt.woff2",
  weight: "400 700",
  variable: "--font-inter-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0100-024F, U+0259, U+02B0-02FF, U+0300-036F, U+0370-03FF, U+1E00-1EFF, U+FB01-FB02",
    },
  ],
});

// Code only (SQL, DAX, the AI request's payload), so it isn't preloaded: it downloads on the pages
// that show code.
const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  weight: "100 900",
  variable: "--font-geist-mono",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const instrumentSerif = localFont({
  src: [
    { path: "./fonts/InstrumentSerif-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/InstrumentSerif-Italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-instrument-serif",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

export const metadata: Metadata = {
  title: {
    default: "Loupe · Analyst-grade dashboards from clean data",
    template: "%s · Loupe",
  },
  description:
    "Drop in a clean table and get an analyst-grade dashboard in seconds. Loupe profiles your data, detects the industry and computes the KPIs, each with its SQL and DAX, entirely in your browser: nothing is uploaded.",
  applicationName: "Loupe",
  authors: [{ name: AUTHOR }],
  creator: AUTHOR,
  keywords: [
    "dashboard",
    "KPI",
    "data profiling",
    "DAX",
    "Power BI",
    "SQL",
    "e-commerce analytics",
    "business intelligence",
  ],
  openGraph: { type: "website", siteName: "Loupe", locale: "en_GB" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0c0e" },
    { media: "(prefers-color-scheme: light)", color: "#f7f6f2" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${inter.variable} ${interExt.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <script dangerouslySetInnerHTML={{ __html: chartThemeBootScript }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only-focusable fixed top-4 left-4 z-[100] rounded-control bg-accent px-3 py-2 text-ui font-medium text-accent-fg"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
