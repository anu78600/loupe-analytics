/**
 * Root layout for every route. Loads the three type families (Instrument
 * Serif for display via next/font/local, Geist Sans for UI, Geist Mono for
 * figures), sets metadata, and runs themeBootScript in <head> so the saved
 * theme is applied before React hydrates (no light/dark flash). Also renders
 * the skip link and the client Providers (motion config, tooltips, theme
 * sync, toasts).
 */
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/ui/common/providers";
import { themeBootScript } from "@/store/settings";
import { chartThemeBootScript } from "@/ui/charts/palette/apply";
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
    "Upload clean data. Get an analyst-grade dashboard in seconds. Loupe profiles your data, detects the industry, and generates correct KPIs with SQL and DAX, entirely in your browser.",
  applicationName: "Loupe",
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
  openGraph: {
    title: "Loupe · Analyst-grade dashboards from clean data",
    description:
      "Profiling, domain-aware KPIs with SQL and DAX, and a ready dashboard. Your data never leaves your browser.",
    type: "website",
  },
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
