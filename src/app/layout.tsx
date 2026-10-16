/**
 * Root layout for every route. Loads the three type families (Instrument
 * Serif for display via next/font/local, Geist Sans for UI, Geist Mono for
 * figures), sets metadata, and runs themeBootScript in <head> so the saved
 * theme is applied before React hydrates (no light/dark flash). Also renders
 * the skip link and the client Providers (motion config, tooltips, theme
 * sync, toasts).
 *
 * The social tags carry no title or description of their own: Next fills
 * og:title, og:description and Twitter's from each page's own metadata, so a
 * shared link to the version log or the workspace names that page. The image
 * is opengraph-image.tsx; the icons are icon.svg, favicon.ico and
 * apple-icon.tsx in this folder.
 */
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/ui/common/providers";
import { themeBootScript } from "@/store/settings";
import { chartThemeBootScript } from "@/ui/charts/palette/apply";
import { AUTHOR } from "@/content/credits";
import "./globals.css";

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
      className={`${GeistSans.variable} ${GeistMono.variable} ${instrumentSerif.variable}`}
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
